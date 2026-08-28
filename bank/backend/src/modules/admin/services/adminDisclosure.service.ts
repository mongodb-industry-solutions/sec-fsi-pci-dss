import { Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import {
  CARD_ISSUER_VAULT_COLLECTION, CardIssuerVaultRecord,
  ISSUED_CARD_REGISTRY_COLLECTION, IssuedCardRegistryRecord,
} from '../../card-issuer/models/cardIssuerVault.model';
import { deriveCvvForCard } from '../../card-issuer/services/cardCvv.service';
import { cardIssuerConfig } from '../../card-issuer/services/cardValidation.service';
import {
  ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord,
} from '../../aspsp/models/accountArrangement.model';
import { ACCOUNT_HOLDER_COLLECTION, AccountHolderControlRecord } from '../../aspsp/models/accountHolder.model';
import { buildIban } from '../../aspsp/services/bankIdentifier.service';
import { maskName, maskEmail } from './valueMasking';

// Reading the values that are encrypted at rest: a card number, a verification value, an IBAN, a holder's
// name and contact.
//
// Every one of these is a DISCLOSURE, not a read, and the shape of this module says so. Each is its own
// deliberate call rather than a field on a detail response, so a screen that lists a hundred accounts cannot
// accidentally decrypt a hundred IBANs, and the audit trail records one row per act rather than one row for
// "opened a page". The trail comes for free: the response hook records every request, so a reveal is already
// attributable to the actor who asked, under the correlation id they asked with.
//
// The verification value is not stored anywhere and never has been: it is recomputed from the card data plus
// the issuer key, the way an issuer host does it inside an HSM. So "revealing" it is deriving it.

export interface CardDisclosure {
  cardToken: string;
  cardNumber?: string;
  verificationValue?: string;
  expiry?: string;
  serviceCode?: string;
  error?: string;
}

/**
 * Everything about one card that is normally hidden. Asked for as a whole because an operator looking at a
 * card is looking at the card: three separate round trips would be three audit rows describing one act.
 */
export async function discloseCard(db: Db, cardToken: string): Promise<CardDisclosure | null> {
  const vaulted = await db.collection<CardIssuerVaultRecord>(CARD_ISSUER_VAULT_COLLECTION)
    .findOne({ paymentCardReference: cardToken }, { projection: { _id: 0 } });
  const registered = await db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION)
    .findOne({ paymentCardReference: cardToken }, { projection: { _id: 0 } });
  if (!vaulted && !registered) return null;

  const expiry = registered?.paymentCardExpiryMonth && registered.paymentCardExpiryYear
    ? `${registered.paymentCardExpiryMonth}/${registered.paymentCardExpiryYear}`
    : undefined;

  let verificationValue: string | undefined;
  let error: string | undefined;
  if (expiry) {
    const config = await cardIssuerConfig(db);
    const cvvLength = config.networks.find((n) => n.name === registered?.paymentCardNetwork)?.cvvLength ?? 3;
    verificationValue = await deriveCvvForCard(
      { cardToken, expiry, serviceCode: vaulted?.cardServiceCode, cvvLength },
    );
    // Said plainly rather than shown as blank: an absent key and a card with no verification value look the
    // same on screen otherwise, and they are different problems.
    if (!verificationValue) error = 'the issuer key is unavailable, so no verification value could be derived';
  } else {
    error = 'this card carries no expiry, and the verification value is derived from it';
  }

  return {
    cardToken,
    cardNumber: vaulted?.paymentCardNumber,
    verificationValue,
    expiry,
    serviceCode: vaulted?.cardServiceCode,
    error,
  };
}

export interface AccountDisclosure {
  accountReference: string;
  iban: string;
  bic: string;
}

/** The full IBAN of one account. Personal data under GDPR, which is why it is asked for one at a time. */
export async function discloseAccountIban(db: Db, accountReference: string): Promise<AccountDisclosure | null> {
  const account = await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .findOne({ accountArrangementInstanceReference: accountReference }, { projection: { _id: 0 } });
  if (!account) return null;
  return {
    accountReference,
    iban: account.accountIban,
    bic: account.accountBic,
  };
}

export interface HolderView {
  accountHolderInstanceReference: string;
  accountHolderCountryCode: string;
  accountHolderStatus: string;
  // Masked by default. The name and the contact are both encrypted at rest, so both are disclosures.
  accountHolderNameMasked: string;
  accountHolderEmailMasked?: string;
  accountCount: number;
}

export async function findHolder(db: Db, holderReference: string): Promise<HolderView | null> {
  const holder = await db.collection<AccountHolderControlRecord>(ACCOUNT_HOLDER_COLLECTION)
    .findOne({ accountHolderInstanceReference: holderReference }, { projection: { _id: 0 } });
  if (!holder) return null;
  const accountCount = await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .countDocuments({ accountHolderInstanceReference: holderReference });
  return {
    accountHolderInstanceReference: holder.accountHolderInstanceReference,
    accountHolderCountryCode: holder.accountHolderCountryCode,
    accountHolderStatus: holder.accountHolderStatus,
    accountHolderNameMasked: maskName(holder.accountHolderName ?? ''),
    accountHolderEmailMasked: holder.accountHolderEmailAddress ? maskEmail(holder.accountHolderEmailAddress) : undefined,
    accountCount,
  };
}

export interface HolderDisclosure {
  accountHolderInstanceReference: string;
  accountHolderName: string;
  accountHolderEmailAddress?: string;
}

export async function discloseHolder(db: Db, holderReference: string): Promise<HolderDisclosure | null> {
  const holder = await db.collection<AccountHolderControlRecord>(ACCOUNT_HOLDER_COLLECTION)
    .findOne({ accountHolderInstanceReference: holderReference }, { projection: { _id: 0 } });
  if (!holder) return null;
  return {
    accountHolderInstanceReference: holder.accountHolderInstanceReference,
    accountHolderName: holder.accountHolderName,
    accountHolderEmailAddress: holder.accountHolderEmailAddress,
  };
}

// ── Opening an account ───────────────────────────────────────────────────────────────────────────

export interface OpenAccountInput {
  accountHolderReference: string;
  accountKind: 'current' | 'savings';
  accountCurrency: string;
  accountCountryCode: string;
  accountAlias?: string;
  openingBalance?: number;
}

export type OpenAccountRefusal = 'unknown_holder' | 'no_bank_profile' | 'iban_unavailable';

/**
 * Opens an account, with an IBAN this bank can actually claim.
 *
 * It lands `pending_approval`, never active: opening and approving are two acts, and collapsing them would
 * make the approval step decorative. The IBAN is derived from this bank's own declared bank code plus a
 * check digit, so the account is routable back to it: an IBAN outside every declared code would be an
 * account nothing could reach.
 */
export async function openAccount(
  db: Db, input: OpenAccountInput,
): Promise<{ ok: true; account: AccountArrangementControlRecord } | { ok: false; refusal: OpenAccountRefusal }> {
  const holder = await db.collection<AccountHolderControlRecord>(ACCOUNT_HOLDER_COLLECTION)
    .findOne({ accountHolderInstanceReference: input.accountHolderReference }, { projection: { _id: 0 } });
  if (!holder) return { ok: false, refusal: 'unknown_holder' };

  const profile = await db.collection<{
    bankProfileBic?: string; bankProfileIbanBankCodes?: string[];
  }>('bankProfile').findOne({});
  const bankCode = profile?.bankProfileIbanBankCodes?.find((code) => /^\d{4}$/.test(code));
  if (!profile?.bankProfileBic || !bankCode) return { ok: false, refusal: 'no_bank_profile' };

  // Random national part, so two accounts opened for the same holder on the same day are different
  // accounts. The builder owns the country's structure and refuses what it cannot build correctly.
  const iban = buildIban(input.accountCountryCode, bankCode, (count) => {
    let digits = '';
    while (digits.length < count) digits += String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
    return digits.slice(0, count);
  });
  if (!iban) return { ok: false, refusal: 'iban_unavailable' };

  const now = new Date().toISOString();
  const account: AccountArrangementControlRecord = {
    accountArrangementInstanceReference: randomUUID(),
    accountHolderInstanceReference: input.accountHolderReference,
    bankProfileInstanceReference: (profile as { bankProfileInstanceReference?: string }).bankProfileInstanceReference ?? '',
    accountKind: input.accountKind,
    accountStatus: 'pending_approval',
    accountAlias: input.accountAlias,
    accountCurrency: input.accountCurrency.toUpperCase(),
    accountCountryCode: input.accountCountryCode.toUpperCase(),
    accountIban: iban,
    accountBic: profile.bankProfileBic,
    accountMaskedIban: maskIbanForDisplay(iban),
    accountBalance: {
      // An opening balance is a CREDIT the bank makes, and it is recorded as one: the balance never simply
      // appears. Zero unless asked for, because an account is opened empty.
      availableAmount: input.openingBalance ?? 0,
      pendingAmount: 0,
      reservedAmount: 0,
      currency: input.accountCurrency.toUpperCase(),
      lastUpdatedDateTime: now,
    },
    accountOpenedDateTime: now,
    bianServiceDomain: 'Current Account',
    bianControlRecordType: 'AccountArrangement',
    recordCreatedDateTime: now,
    schemaVersion: 1,
  };

  await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION).insertOne(account);
  return { ok: true, account };
}

// The stored display form, matching every account the bank already holds: country, check digits, then the
// last four, which is the form that appears on a statement.
function maskIbanForDisplay(iban: string): string {
  return `${iban.slice(0, 4)}${'*'.repeat(Math.max(0, iban.length - 8))}${iban.slice(-4)}`;
}

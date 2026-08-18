import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  BANK_CONSENT_AGREEMENT_COLLECTION, BANK_CONSENT_ACCESS_LOG_COLLECTION,
  BankConsentAgreementControlRecord, BankConsentAccessLogRecord,
  ConsentAccessKind, ConsentAccessScope, ConsentStatus,
} from '../models/bankConsent.model';
import { ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord } from '../../aspsp/models/accountArrangement.model';
import { config } from '../../../config';

// Consent lifecycle and enforcement. Every AIS and PIS call passes through `resolveConsent`, which is
// the single place that decides whether an access is authorised, so there is no second implementation
// to drift from this one.

// The consent statuses that mean "usable". Exactly one, deliberately: enforcement fails closed, so an
// unknown or future value is refused rather than assumed benign.
const USABLE: ConsentStatus = 'valid';

function collection(db: Db) {
  return db.collection<BankConsentAgreementControlRecord>(BANK_CONSENT_AGREEMENT_COLLECTION);
}

export async function recordAccess(db: Db, entry: Omit<BankConsentAccessLogRecord, 'bankConsentAccessLogInstanceReference' | 'recordCreatedDateTime' | 'schemaVersion'>): Promise<void> {
  await db.collection<BankConsentAccessLogRecord>(BANK_CONSENT_ACCESS_LOG_COLLECTION).insertOne({
    ...entry,
    bankConsentAccessLogInstanceReference: `cal-${uuidv4()}`,
    recordCreatedDateTime: new Date().toISOString(),
    schemaVersion: 1,
  });
}

export interface CreateConsentInput {
  tppClientId: string;
  // IBANs, as the standard's access object sends them. They are resolved to account references here.
  accountIbans: string[];
  balanceIbans?: string[];
  transactionIbans?: string[];
  recurringIndicator?: boolean;
  frequencyPerDay?: number;
  validUntil?: string;
}

export type CreateConsentResult =
  | { ok: true; consent: BankConsentAgreementControlRecord }
  | { ok: false; code: 'CONSENT_INVALID' | 'RESOURCE_UNKNOWN'; text: string };

function defaultValidUntil(): string {
  const until = new Date();
  until.setFullYear(until.getFullYear() + 1);
  return until.toISOString().slice(0, 10);
}

/**
 * Creates a consent. In `automatic` mode it lands `valid` because the TPP is registered, which is this
 * demo's stated authorisation model; in `manual` mode it lands `received` and waits for an operator.
 * The transition records its reason either way, so "why is this usable" is answerable from the record.
 */
export async function createConsent(db: Db, input: CreateConsentInput): Promise<CreateConsentResult> {
  const requestedIbans = [...new Set([
    ...input.accountIbans,
    ...(input.balanceIbans ?? []),
    ...(input.transactionIbans ?? []),
  ])];
  if (requestedIbans.length === 0) {
    return { ok: false, code: 'CONSENT_INVALID', text: 'access must name at least one account' };
  }

  const records = await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .find({ accountIban: { $in: requestedIbans } }, { projection: { _id: 0 } })
    .toArray();
  const byIban = new Map(records.map((record) => [record.accountIban, record]));

  const unknown = requestedIbans.filter((iban) => !byIban.has(iban));
  if (unknown.length > 0) {
    // Naming the account is safe: the caller sent it, so this discloses nothing it did not already know.
    return { ok: false, code: 'RESOURCE_UNKNOWN', text: `not an account at this bank: ${unknown.join(', ')}` };
  }

  // One consent covers one PSU. Accounts of two different holders in one consent has no meaning under
  // the standard, and letting it through would make the holder derivation on every read ambiguous.
  const holders = new Set(records.map((record) => record.accountHolderInstanceReference));
  if (holders.size > 1) {
    return { ok: false, code: 'CONSENT_INVALID', text: 'a consent covers the accounts of one account holder' };
  }

  const refs = (ibans: string[] | undefined, fallback: string[]): string[] => (
    ibans && ibans.length > 0 ? ibans.map((iban) => byIban.get(iban)!.accountArrangementInstanceReference) : fallback
  );
  const accountRefs = refs(input.accountIbans, []);
  const access: ConsentAccessScope = {
    accounts: accountRefs,
    // Omitted balance or transaction access defaults to the account list: the standard treats a
    // dedicated access list as a narrowing, and narrowing to nothing would create a useless consent.
    balances: refs(input.balanceIbans, accountRefs),
    transactions: refs(input.transactionIbans, accountRefs),
  };

  const automatic = config.bank.consentMode === 'automatic';
  const now = new Date().toISOString();
  const consent: BankConsentAgreementControlRecord = {
    bankConsentAgreementInstanceReference: `cns-${uuidv4()}`,
    bankConsentTppClientId: input.tppClientId,
    bankConsentAccountHolderInstanceReference: [...holders][0],
    bankConsentAccess: access,
    bankConsentRecurringIndicator: input.recurringIndicator ?? true,
    bankConsentFrequencyPerDay: input.frequencyPerDay ?? 4,
    bankConsentValidUntil: input.validUntil ?? defaultValidUntil(),
    bankConsentStatus: automatic ? 'valid' : 'received',
    bankConsentStatusReason: automatic ? 'tpp_registered' : 'awaiting_bank_authorisation',
    bankConsentStatusChangedDateTime: now,
    bankConsentLastActionDate: now,
    bianServiceDomain: 'Customer Agreement',
    bianControlRecordType: 'CustomerAccessConsent',
    recordCreatedDateTime: now,
    schemaVersion: 1,
  };

  await collection(db).insertOne(consent);
  await recordAccess(db, {
    bankConsentAgreementInstanceReference: consent.bankConsentAgreementInstanceReference,
    bankConsentTppClientId: input.tppClientId,
    accessedResourceKind: 'consent',
    accessDecision: 'granted',
    accessDecisionReason: `created ${consent.bankConsentStatus} (${consent.bankConsentStatusReason})`,
  });
  return { ok: true, consent };
}

export async function findConsent(
  db: Db,
  consentId: string,
  tppClientId: string,
): Promise<BankConsentAgreementControlRecord | null> {
  // Scoped to the holder of the consent. Another TPP's consent must be indistinguishable from one that
  // does not exist, or the endpoint becomes a way to probe for them.
  return collection(db).findOne(
    { bankConsentAgreementInstanceReference: consentId, bankConsentTppClientId: tppClientId },
    { projection: { _id: 0 } },
  );
}

export async function changeConsentStatus(
  db: Db,
  consentId: string,
  status: ConsentStatus,
  reason: string,
): Promise<BankConsentAgreementControlRecord | null> {
  const now = new Date().toISOString();
  await collection(db).updateOne(
    { bankConsentAgreementInstanceReference: consentId },
    {
      $set: {
        bankConsentStatus: status,
        bankConsentStatusReason: reason,
        bankConsentStatusChangedDateTime: now,
        bankConsentLastActionDate: now,
        recordUpdatedDateTime: now,
      },
    },
  );
  const updated = await collection(db).findOne(
    { bankConsentAgreementInstanceReference: consentId },
    { projection: { _id: 0 } },
  );
  if (updated) {
    await recordAccess(db, {
      bankConsentAgreementInstanceReference: consentId,
      bankConsentTppClientId: updated.bankConsentTppClientId,
      accessedResourceKind: 'consent',
      accessDecision: 'granted',
      accessDecisionReason: `status changed to ${status} (${reason})`,
    });
  }
  return updated;
}

function isExpired(consent: BankConsentAgreementControlRecord, now: Date): boolean {
  // A date-only validUntil is inclusive of that day, so compare against its end.
  const until = new Date(`${consent.bankConsentValidUntil.slice(0, 10)}T23:59:59.999Z`);
  return now.getTime() > until.getTime();
}

export interface ConsentRefusal {
  // Berlin Group's own error codes, with the status the specification pairs them with.
  status: 401 | 403;
  code: 'CONSENT_UNKNOWN' | 'CONSENT_INVALID' | 'CONSENT_EXPIRED';
  text: string;
}

export type ConsentResolution =
  | { ok: true; consent: BankConsentAgreementControlRecord }
  | { ok: false; refusal: ConsentRefusal };

/**
 * The gate every consent-bearing call goes through: the consent must exist, belong to this TPP, be
 * `valid`, still be within its validity, and cover the account and the kind of access being made.
 * Fails closed on anything else, including a status this code does not know.
 */
export async function resolveConsent(
  db: Db,
  input: {
    consentId: string;
    tppClientId: string;
    kind: ConsentAccessKind;
    accountReference?: string;
    correlationId?: string;
  },
): Promise<ConsentResolution> {
  const refuse = async (refusal: ConsentRefusal): Promise<ConsentResolution> => {
    await recordAccess(db, {
      bankConsentAgreementInstanceReference: input.consentId,
      bankConsentTppClientId: input.tppClientId,
      accessedAccountReference: input.accountReference,
      accessedResourceKind: input.kind,
      accessDecision: 'refused',
      accessDecisionReason: `${refusal.code}: ${refusal.text}`,
      accessCorrelationId: input.correlationId,
    });
    return { ok: false, refusal };
  };

  const consent = await findConsent(db, input.consentId, input.tppClientId);
  if (!consent) {
    return refuse({ status: 403, code: 'CONSENT_UNKNOWN', text: 'No such consent for this client' });
  }

  if (consent.bankConsentStatus === USABLE && isExpired(consent, new Date())) {
    // Lapsed validity IS a status change, so it is recorded rather than evaluated again on every call.
    await changeConsentStatus(db, consent.bankConsentAgreementInstanceReference, 'expired', 'validity_lapsed');
    return refuse({ status: 401, code: 'CONSENT_EXPIRED', text: 'The consent validity has lapsed' });
  }

  if (consent.bankConsentStatus !== USABLE) {
    return refuse({
      status: 401,
      code: consent.bankConsentStatus === 'expired' ? 'CONSENT_EXPIRED' : 'CONSENT_INVALID',
      text: `The consent is ${consent.bankConsentStatus}, not valid`,
    });
  }

  const granted = consent.bankConsentAccess[input.kind] ?? [];
  if (input.accountReference && !granted.includes(input.accountReference)) {
    return refuse({ status: 401, code: 'CONSENT_INVALID', text: 'The consent does not cover this account for this access' });
  }

  await recordAccess(db, {
    bankConsentAgreementInstanceReference: consent.bankConsentAgreementInstanceReference,
    bankConsentTppClientId: input.tppClientId,
    accessedAccountReference: input.accountReference,
    accessedResourceKind: input.kind,
    accessDecision: 'granted',
    accessCorrelationId: input.correlationId,
  });
  // lastActionDate is the standard's "when was this consent last used", so a read updates it.
  await collection(db).updateOne(
    { bankConsentAgreementInstanceReference: consent.bankConsentAgreementInstanceReference },
    { $set: { bankConsentLastActionDate: new Date().toISOString() } },
  );
  return { ok: true, consent };
}

// ── The standard resource ────────────────────────────────────────────────────────────────────────

export interface BerlinGroupConsentResource {
  consentId: string;
  consentStatus: ConsentStatus;
  access: { accounts: Array<{ iban: string }>; balances: Array<{ iban: string }>; transactions: Array<{ iban: string }> };
  recurringIndicator: boolean;
  validUntil: string;
  frequencyPerDay: number;
  lastActionDate: string;
}

/** Maps the control record to the standard resource, resolving account references back to IBANs. */
export async function toBerlinGroupConsent(
  db: Db,
  consent: BankConsentAgreementControlRecord,
): Promise<BerlinGroupConsentResource> {
  const refs = [...new Set([
    ...consent.bankConsentAccess.accounts,
    ...consent.bankConsentAccess.balances,
    ...consent.bankConsentAccess.transactions,
  ])];
  const records = await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .find({ accountArrangementInstanceReference: { $in: refs } }, { projection: { _id: 0, accountArrangementInstanceReference: 1, accountIban: 1 } })
    .toArray();
  const ibanOf = new Map(records.map((record) => [record.accountArrangementInstanceReference, record.accountIban]));
  const asIbans = (list: string[]) => list
    .map((ref) => ibanOf.get(ref))
    .filter((iban): iban is string => Boolean(iban))
    .map((iban) => ({ iban }));

  return {
    consentId: consent.bankConsentAgreementInstanceReference,
    consentStatus: consent.bankConsentStatus,
    access: {
      accounts: asIbans(consent.bankConsentAccess.accounts),
      balances: asIbans(consent.bankConsentAccess.balances),
      transactions: asIbans(consent.bankConsentAccess.transactions),
    },
    recurringIndicator: consent.bankConsentRecurringIndicator,
    validUntil: consent.bankConsentValidUntil.slice(0, 10),
    frequencyPerDay: consent.bankConsentFrequencyPerDay,
    lastActionDate: consent.bankConsentLastActionDate.slice(0, 10),
  };
}

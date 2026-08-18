import { Db } from 'mongodb';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../models/payoutAccount.model';
import {
  createBankConsent, readBankConsentStatus,
} from '../../../providers/account-information/services/bankcoreAis.client';

// Acquiring the consent that authorises the PSP to read a linked account (P4.4).
//
// The rule this service exists to enforce: **created is not authorised.** The PSP creates the consent and
// the bank decides when it becomes usable, so the status is stored as the bank reported it and a link is
// only usable at `valid`. There is deliberately no "our own bank, so it must be fine" path: against a bank
// requiring SCA the same code has to wait, and a shortcut here is what would make that a rewrite.

// The only usable value, per Berlin Group. Everything else, including a status this code has never seen,
// leaves the link unusable.
export const USABLE_CONSENT_STATUS = 'valid';

export type ConsentAcquisitionOutcome =
  // Usable now: either it already was, or the bank authorised it on creation.
  | { state: 'valid'; consentReference: string }
  // Created but not usable yet. A real outcome, not an error: the bank may be waiting for an operator or
  // for the customer's SCA, and the notification (or a later poll) is what resolves it.
  | { state: 'pending'; consentReference: string; consentStatus: string }
  // The bank said no, or said something we do not recognise. Either way the link is not usable.
  | { state: 'unusable'; consentReference?: string; consentStatus?: string }
  | { state: 'error'; error: string };

export interface ConsentPorts {
  create: typeof createBankConsent;
  readStatus: typeof readBankConsentStatus;
}

const defaultPorts: ConsentPorts = { create: createBankConsent, readStatus: readBankConsentStatus };

async function storeConsentOnLink(
  db: Db,
  accountReference: string,
  consentReference: string,
  consentStatus: string,
): Promise<void> {
  // One document at a time: Queryable Encryption rejects a multi-document update on an encrypted
  // collection, and this is one. The same pattern the notification receiver uses.
  await db.collection(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    { payoutAccountInstanceReference: accountReference },
    {
      $set: {
        payoutAccountConsentReference: consentReference,
        payoutAccountConsentStatus: consentStatus,
        payoutAccountConsentStatusChangedDateTime: new Date(),
        recordUpdatedDateTime: new Date(),
      },
    },
  );
}

/**
 * Makes sure a linked account has a consent, creating one at the bank if it does not.
 *
 * Idempotent in the way that matters: an account that already holds a `valid` consent is left alone, so
 * this can be called before any read without creating a consent per call.
 */
export async function ensureConsentForLink(
  db: Db,
  account: PayoutAccountArrangement,
  options: { correlationId?: string; ports?: ConsentPorts } = {},
): Promise<ConsentAcquisitionOutcome> {
  const ports = options.ports ?? defaultPorts;
  const accountReference = account.payoutAccountInstanceReference;

  if (!account.payoutAccountIban) {
    return { state: 'error', error: 'the linked account has no IBAN to request access for' };
  }

  // Already usable: nothing to do. The status is what the bank last told us, kept by the notification
  // receiver, so this is not a stale local guess.
  if (account.payoutAccountConsentReference && account.payoutAccountConsentStatus === USABLE_CONSENT_STATUS) {
    return { state: 'valid', consentReference: account.payoutAccountConsentReference };
  }

  // A consent exists but is not usable. Ask the bank rather than assuming: this is the polling fallback for
  // a notification that never arrived, and it is the only honest way to recover from one.
  if (account.payoutAccountConsentReference) {
    const { consentStatus, error } = await ports.readStatus({
      consentReference: account.payoutAccountConsentReference,
      correlationId: options.correlationId,
    });
    if (error) return { state: 'error', error };
    await storeConsentOnLink(db, accountReference, account.payoutAccountConsentReference, consentStatus ?? 'unknown');
    if (consentStatus === USABLE_CONSENT_STATUS) {
      return { state: 'valid', consentReference: account.payoutAccountConsentReference };
    }
    // `received` is pending and may still become valid; anything else is terminal for this consent.
    return consentStatus === 'received'
      ? { state: 'pending', consentReference: account.payoutAccountConsentReference, consentStatus }
      : { state: 'unusable', consentReference: account.payoutAccountConsentReference, consentStatus };
  }

  const created = await ports.create({
    accountIbans: [account.payoutAccountIban],
    correlationId: options.correlationId,
  });
  if (created.error || !created.consentReference) {
    return { state: 'error', error: created.error ?? 'the bank returned no consent reference' };
  }

  const status = created.consentStatus ?? 'received';
  await storeConsentOnLink(db, accountReference, created.consentReference, status);
  if (status === USABLE_CONSENT_STATUS) return { state: 'valid', consentReference: created.consentReference };
  return status === 'received'
    ? { state: 'pending', consentReference: created.consentReference, consentStatus: status }
    : { state: 'unusable', consentReference: created.consentReference, consentStatus: status };
}

/**
 * Polls a pending consent a bounded number of times.
 *
 * Bounded on purpose: this is the fallback for a missed notification, not the normal path, and a link that
 * a bank leaves at `received` for an hour must not hold a request open. The caller gets `pending` back and
 * shows the link as pending, which is the honest state.
 */
export async function awaitConsentValid(
  db: Db,
  account: PayoutAccountArrangement,
  options: { attempts?: number; delayMs?: number; correlationId?: string; ports?: ConsentPorts } = {},
): Promise<ConsentAcquisitionOutcome> {
  const attempts = Math.max(1, options.attempts ?? 3);
  let last: ConsentAcquisitionOutcome = { state: 'error', error: 'not attempted' };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await ensureConsentForLink(db, account, options);
    if (last.state !== 'pending') return last;
    if (attempt < attempts && options.delayMs) {
      await new Promise((done) => setTimeout(done, options.delayMs));
    }
    // The record now carries the reference, so the next attempt polls instead of creating a second consent.
    account = { ...account, payoutAccountConsentReference: last.consentReference } as PayoutAccountArrangement;
  }
  return last;
}

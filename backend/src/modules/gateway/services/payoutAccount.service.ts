// Payout Account Arrangement service
// CRUD for PSP payout accounts + atomic default-account management.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'node:crypto';
import { projectBalances, projectBalance } from './payoutAccountBalanceProjection';
import {
  PAYOUT_ACCOUNT_COLLECTION,
  PayoutAccountArrangement,
  PayoutAccountType,
  PayoutAccountStatus,
  PayoutRail,
} from '../models/payoutAccount.model';

// Stable stream of decimal digits. With a seed it is DETERMINISTIC (SHA-256 of the seed), so
// seed backfill stays idempotent (R6); without a seed it falls back to a random stream.
function digitStream(seed: string | undefined, n: number): string {
  let out = '';
  if (seed) {
    let i = 0;
    while (out.length < n) {
      const h = createHash('sha256').update(`${seed}:${i++}`).digest('hex');
      out += BigInt(`0x${h}`).toString().replace(/\D/g, '');
    }
  } else {
    while (out.length < n) out += Math.floor(Math.random() * 1e15).toString();
  }
  return out.slice(0, n);
}

// Demo IBAN generator (v30.1). Produces a well-formed IBAN with a valid ISO 7064 mod-97 check.
// Demo data only, never a real account. Deterministic when a seed is given (idempotent seed backfill).
// The IBAN is stored QE-encrypted like any other.
export function generateDemoIban(countryCode: string, seed?: string): string {
  // Fall back to 'GB' unless a valid 2-letter ISO code is present: garbage input like "1" would
  // otherwise normalize to "XX" and produce a bogus IBAN country.
  const cleaned = (countryCode || '').toUpperCase().replace(/[^A-Z]/g, '');
  const cc = cleaned.length === 2 ? cleaned : 'GB';
  // BBAN length by country (fallback 18). Kept simple; digits only for the demo.
  const bbanLen: Record<string, number> = { GB: 18, DE: 18, ES: 20, FR: 23, US: 18, NL: 14, IT: 23, PT: 21 };
  const len = bbanLen[cc] ?? 18;
  const bban = digitStream(seed, len);
  // mod-97: move CC+00 to the end, encode letters (A=10..Z=35), compute 98 - (n mod 97).
  const rearranged = `${bban}${cc}00`;
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => (ch.charCodeAt(0) - 55).toString());
  let rem = 0;
  for (const d of numeric) rem = (rem * 10 + Number(d)) % 97;
  const check = (98 - rem).toString().padStart(2, '0');
  return `${cc}${check}${bban}`;
}

// Demo routing / national clearing number (9 digits, ABA-style). Deterministic when seeded. Demo only.
export function generateDemoRouting(seed?: string): string {
  return digitStream(seed, 9);
}

export interface CreatePayoutAccountInput {
  partyInstanceReference: string;
  payoutAccountType: PayoutAccountType;
  payoutAccountCurrency: string;
  payoutAccountCountryCode: string;
  payoutAccountPreferredRail: PayoutRail;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
  payoutAccountHolderName?: string;
  payoutAccountBicSwift?: string;
  payoutAccountCorrespondentBic?: string;
  payoutAccountBankAddress?: string;
  payoutAccountIban?: string;
  payoutAccountRoutingNumber?: string;
  payoutAccountIsDefault?: boolean;
}

export async function listPayoutAccounts(
  db: Db,
  partyRef: string,
  opts?: { status?: PayoutAccountStatus; page?: number; limit?: number },
): Promise<{ results: PayoutAccountArrangement[]; total: number }> {
  const query: Record<string, unknown> = { partyInstanceReference: partyRef };
  if (opts?.status) query.payoutAccountStatus = opts.status;

  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;

  const col = db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION);
  const [results, total] = await Promise.all([
    col.find(query).sort({ payoutAccountIsDefault: -1, recordCreatedDateTime: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(query),
  ]);
  // v37 P2.4: with the bank enabled, the balance comes from the institution that holds the account, at
  // the same field path every consumer already reads. With it off this is a no-op.
  return { results: await projectBalances(results), total };
}

// v29 admin (built-in module account-information): cross-party GLOBAL payout-account list for
// the operations officer. Returns raw arrangements (caller strips QE fields via safeAccount, adding
// payoutAccountHasIban/payoutAccountHasRoutingNumber hints: PCI/GDPR minimization). Paginated +
// filterable by status / party / currency.
export async function listAllPayoutAccounts(
  db: Db,
  opts?: { page?: number; limit?: number; status?: PayoutAccountStatus; party?: string; currency?: string },
): Promise<{ results: PayoutAccountArrangement[]; total: number; page: number; limit: number }> {
  const query: Record<string, unknown> = {};
  if (opts?.status) query.payoutAccountStatus = opts.status;
  if (opts?.party) query.partyInstanceReference = opts.party;
  if (opts?.currency) query.payoutAccountCurrency = opts.currency;

  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;

  const col = db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION);
  const [results, total] = await Promise.all([
    col.find(query).sort({ recordCreatedDateTime: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(query),
  ]);
  return { results, total, page, limit };
}

export async function getPayoutAccount(
  db: Db,
  payoutAccountRef: string,
): Promise<PayoutAccountArrangement | null> {
  const account = await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
    .findOne({ payoutAccountInstanceReference: payoutAccountRef });
  // Same projection as the list path, so a single-account read never disagrees with the list.
  return account ? projectBalance(account) : null;
}

export async function getDefaultPayoutAccount(
  db: Db,
  partyRef: string,
): Promise<PayoutAccountArrangement | null> {
  return db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
    .findOne({ partyInstanceReference: partyRef, payoutAccountIsDefault: true, payoutAccountStatus: 'active' });
}

export async function createPayoutAccount(
  db: Db,
  input: CreatePayoutAccountInput,
): Promise<PayoutAccountArrangement> {
  const col = db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION);
  const now = new Date();

  // If this is the first account, make it default automatically
  const existingCount = await col.countDocuments({ partyInstanceReference: input.partyInstanceReference });
  const isDefault = input.payoutAccountIsDefault ?? existingCount === 0;
  const id = uuidv4();

  const record: PayoutAccountArrangement = {
    payoutAccountInstanceReference: id,
    partyInstanceReference: input.partyInstanceReference,
    payoutAccountType: input.payoutAccountType,
    payoutAccountStatus: 'active',
    payoutAccountIsDefault: isDefault,
    payoutAccountCurrency: input.payoutAccountCurrency,
    payoutAccountCountryCode: input.payoutAccountCountryCode,
    payoutAccountPreferredRail: input.payoutAccountPreferredRail,
    // Optional plaintext fields, only include when provided
    ...(input.payoutAccountAlias ? { payoutAccountAlias: input.payoutAccountAlias } : {}),
    ...(input.payoutAccountBankName ? { payoutAccountBankName: input.payoutAccountBankName } : {}),
    ...(input.payoutAccountHolderName ? { payoutAccountHolderName: input.payoutAccountHolderName } : {}),
    ...(input.payoutAccountBicSwift ? { payoutAccountBicSwift: input.payoutAccountBicSwift.toUpperCase() } : {}),
    ...(input.payoutAccountCorrespondentBic ? { payoutAccountCorrespondentBic: input.payoutAccountCorrespondentBic.toUpperCase() } : {}),
    ...(input.payoutAccountBankAddress ? { payoutAccountBankAddress: input.payoutAccountBankAddress } : {}),
    // QE-encrypted fields: MUST be absent (not null/undefined) when not provided.
    // MongoDB error 31041: "Cannot encrypt element of type: null", QE driver rejects null values.
    // v30.1: auto-generate a valid demo IBAN + routing when the caller leaves them empty, but ONLY for
    // externally-linked accounts. `internal_ledger` accounts intentionally have no bank identifiers, so
    // they are left absent unless explicitly provided. The demo IBAN/routing are seeded with the unique
    // account id (not the party ref) so a party with several accounts never gets duplicate identifiers.
    ...(input.payoutAccountType === 'internal_ledger'
      ? {
          ...(input.payoutAccountIban ? { payoutAccountIban: input.payoutAccountIban } : {}),
          ...(input.payoutAccountRoutingNumber ? { payoutAccountRoutingNumber: input.payoutAccountRoutingNumber } : {}),
        }
      : {
          payoutAccountIban: input.payoutAccountIban || generateDemoIban(input.payoutAccountCountryCode, id),
          payoutAccountRoutingNumber: input.payoutAccountRoutingNumber || generateDemoRouting(id),
        }),
    payoutAccountBalance: {
      pendingAmount: 0,
      availableAmount: 0,
      reservedAmount: 0,
      currency: input.payoutAccountCurrency,
      lastUpdatedDateTime: now,
    },
    bianServiceDomain: 'Payment Initiation',
    bianControlRecordType: 'PayoutAccountArrangement',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };

  if (isDefault) {
    // Clear previous default atomically
    await col.updateMany(
      { partyInstanceReference: input.partyInstanceReference, payoutAccountIsDefault: true },
      { $set: { payoutAccountIsDefault: false, recordUpdatedDateTime: now } },
    );
  }

  await col.insertOne(record);
  return record;
}

export async function setDefaultPayoutAccount(
  db: Db,
  partyRef: string,
  payoutAccountRef: string,
): Promise<boolean> {
  const col = db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION);
  const now = new Date();

  const target = await col.findOne({
    payoutAccountInstanceReference: payoutAccountRef,
    partyInstanceReference: partyRef,
  });
  if (!target || target.payoutAccountStatus !== 'active') return false;

  // Atomic swap: clear old default, set new default
  await col.bulkWrite([
    {
      updateMany: {
        filter: { partyInstanceReference: partyRef, payoutAccountIsDefault: true },
        update: { $set: { payoutAccountIsDefault: false, recordUpdatedDateTime: now } },
      },
    },
    {
      updateOne: {
        filter: { payoutAccountInstanceReference: payoutAccountRef },
        update: { $set: { payoutAccountIsDefault: true, recordUpdatedDateTime: now } },
      },
    },
  ]);
  return true;
}

export async function closePayoutAccount(
  db: Db,
  partyRef: string,
  payoutAccountRef: string,
): Promise<boolean> {
  const result = await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    {
      payoutAccountInstanceReference: payoutAccountRef,
      partyInstanceReference: partyRef,
      payoutAccountStatus: { $ne: 'closed' },
    },
    { $set: { payoutAccountStatus: 'closed', payoutAccountIsDefault: false, recordUpdatedDateTime: new Date() } },
  );
  return result.modifiedCount === 1;
}

export interface UpdatePayoutAccountInput {
  // Preferences
  payoutAccountAlias?: string;
  payoutAccountIsDefault?: boolean;
  // Mutable banking metadata (IBAN / currency / type are immutable)
  payoutAccountBankName?: string;
  payoutAccountHolderName?: string;
  payoutAccountBicSwift?: string;
  payoutAccountCorrespondentBic?: string;
  payoutAccountBankAddress?: string;
}

export async function updatePayoutAccount(
  db: Db,
  accountRef: string,
  patch: UpdatePayoutAccountInput,
): Promise<PayoutAccountArrangement | null> {
  const col = db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION);
  const now = new Date();
  // payoutAccountIban, payoutAccountRoutingNumber, payoutAccountCurrency,
  // payoutAccountType, partyInstanceReference are immutable after creation.
  const safePatch: Record<string, unknown> = { recordUpdatedDateTime: now };
  if (patch.payoutAccountAlias !== undefined) safePatch.payoutAccountAlias = patch.payoutAccountAlias;
  if (patch.payoutAccountIsDefault !== undefined) safePatch.payoutAccountIsDefault = patch.payoutAccountIsDefault;
  if (patch.payoutAccountBankName !== undefined) safePatch.payoutAccountBankName = patch.payoutAccountBankName;
  if (patch.payoutAccountHolderName !== undefined) safePatch.payoutAccountHolderName = patch.payoutAccountHolderName;
  if (patch.payoutAccountBicSwift !== undefined) safePatch.payoutAccountBicSwift = patch.payoutAccountBicSwift.toUpperCase();
  if (patch.payoutAccountCorrespondentBic !== undefined) safePatch.payoutAccountCorrespondentBic = patch.payoutAccountCorrespondentBic.toUpperCase();
  if (patch.payoutAccountBankAddress !== undefined) safePatch.payoutAccountBankAddress = patch.payoutAccountBankAddress;
  // QE constraint: findOneAndUpdate with returnDocument:'after' uses new:true which is
  // unsupported on encrypted collections. Use updateOne + findOne instead.
  await col.updateOne({ payoutAccountInstanceReference: accountRef }, { $set: safePatch });
  return col.findOne({ payoutAccountInstanceReference: accountRef });
}

// v30.1 administrative ownership reassignment: move a payout account to a different party. This is a
// deliberately separate, explicit operation (the generic update keeps partyInstanceReference
// immutable). Callers MUST audit it. Returns the updated account, or null when not found.
export async function reassignPayoutAccountOwner(
  db: Db,
  accountRef: string,
  newPartyRef: string,
): Promise<PayoutAccountArrangement | null> {
  const col = db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION);
  await col.updateOne(
    { payoutAccountInstanceReference: accountRef },
    { $set: { partyInstanceReference: newPartyRef, recordUpdatedDateTime: new Date() } },
  );
  return col.findOne({ payoutAccountInstanceReference: accountRef });
}

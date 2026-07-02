// BIAN SD-66: Payout Account Arrangement service
// CRUD for PSP payout accounts + atomic default-account management.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  PAYOUT_ACCOUNT_COLLECTION,
  PayoutAccountArrangement,
  PayoutAccountType,
  PayoutAccountStatus,
  PayoutRail,
} from '../models/payoutAccount.model';

export interface CreatePayoutAccountInput {
  partyInstanceReference: string;
  payoutAccountType: PayoutAccountType;
  payoutAccountCurrency: string;
  payoutAccountCountryCode: string;
  payoutAccountPreferredRail: PayoutRail;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
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
  return { results, total };
}

export async function getPayoutAccount(
  db: Db,
  payoutAccountRef: string,
): Promise<PayoutAccountArrangement | null> {
  return db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
    .findOne({ payoutAccountInstanceReference: payoutAccountRef });
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

  const record: PayoutAccountArrangement = {
    payoutAccountInstanceReference: uuidv4(),
    partyInstanceReference: input.partyInstanceReference,
    payoutAccountType: input.payoutAccountType,
    payoutAccountStatus: 'active',
    payoutAccountIsDefault: isDefault,
    payoutAccountAlias: input.payoutAccountAlias,
    payoutAccountBankName: input.payoutAccountBankName,
    payoutAccountIban: input.payoutAccountIban,
    payoutAccountRoutingNumber: input.payoutAccountRoutingNumber,
    payoutAccountCurrency: input.payoutAccountCurrency,
    payoutAccountCountryCode: input.payoutAccountCountryCode,
    payoutAccountPreferredRail: input.payoutAccountPreferredRail,
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

export async function updatePayoutAccount(
  db: Db,
  accountRef: string,
  patch: { payoutAccountAlias?: string; payoutAccountIsDefault?: boolean }
): Promise<PayoutAccountArrangement | null> {
  const col = db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION);
  const now = new Date();
  // BIAN SD-66: IBAN, currency, payoutAccountType, partyInstanceReference are immutable
  const safePatch: Record<string, unknown> = { recordUpdatedDateTime: now };
  if (patch.payoutAccountAlias !== undefined) safePatch.payoutAccountAlias = patch.payoutAccountAlias;
  if (patch.payoutAccountIsDefault !== undefined) safePatch.payoutAccountIsDefault = patch.payoutAccountIsDefault;
  // QE constraint: findOneAndUpdate with returnDocument:'after' uses new:true which is
  // unsupported on encrypted collections. Use updateOne + findOne instead.
  await col.updateOne({ payoutAccountInstanceReference: accountRef }, { $set: safePatch });
  return col.findOne({ payoutAccountInstanceReference: accountRef });
}

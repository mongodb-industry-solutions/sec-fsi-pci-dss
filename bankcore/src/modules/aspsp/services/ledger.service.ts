import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord } from '../models/accountArrangement.model';
import { ACCOUNT_MOVEMENT_COLLECTION, AccountMovementRecord, MovementDirection, MovementKind } from '../models/accountMovement.model';
import { BALANCE_CREDIT_LOG_COLLECTION, BalanceCreditLogEntry, CreditType } from '../models/balanceCreditLog.model';

// The bank's internal ledger. These are the mutators the PSP core used to own, now where they are
// legitimate: a bank moving money on its own accounts.
//
// Every mutation is a single conditional update with $inc, never a read then write: two concurrent
// debits that each read the same balance would both pass their own check and overdraw the account.
// The condition is part of the update, so the second one simply does not match.

export interface LedgerResult {
  applied: boolean;
  // Why not, when it was refused. `insufficient_funds` is a business outcome, not an error.
  reason?: 'account_not_found_or_inactive' | 'insufficient_funds' | 'insufficient_pending' | 'insufficient_reserved';
  balanceAfter?: number;
}

type BalanceField = 'availableAmount' | 'pendingAmount' | 'reservedAmount';

function path(field: BalanceField): string {
  return `accountBalance.${field}`;
}

function stamps() {
  const now = new Date();
  return { 'accountBalance.lastUpdatedDateTime': now, recordUpdatedDateTime: now.toISOString() };
}

// One conditional update, returning the document AFTER it so the caller can record the movement
// without a second read that another writer could have changed underneath it.
async function applyIncrement(
  db: Db,
  accountRef: string,
  increments: Partial<Record<BalanceField, number>>,
  guards: Partial<Record<BalanceField, number>>,
  guardReason: LedgerResult['reason'],
): Promise<LedgerResult> {
  const filter: Record<string, unknown> = {
    accountArrangementInstanceReference: accountRef,
    accountStatus: 'active',
  };
  for (const [field, minimum] of Object.entries(guards)) {
    filter[path(field as BalanceField)] = { $gte: minimum };
  }
  const inc: Record<string, number> = {};
  for (const [field, delta] of Object.entries(increments)) inc[path(field as BalanceField)] = delta as number;

  const updated = await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .findOneAndUpdate(filter, { $inc: inc, $set: stamps() }, { returnDocument: 'after' });

  if (!updated) {
    // Distinguish "no such active account" from "the guard refused", since the two send whoever is
    // debugging in different directions.
    const exists = await db.collection(ACCOUNT_ARRANGEMENT_COLLECTION)
      .countDocuments({ accountArrangementInstanceReference: accountRef, accountStatus: 'active' }, { limit: 1 });
    return { applied: false, reason: exists ? guardReason : 'account_not_found_or_inactive' };
  }
  return { applied: true, balanceAfter: updated.accountBalance.availableAmount };
}

async function recordMovement(
  db: Db,
  account: { accountRef: string; currency: string },
  movement: {
    kind: MovementKind;
    direction: MovementDirection;
    amount: number;
    balanceAfter: number;
    correlationId: string;
    remittanceInformation?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const record: AccountMovementRecord = {
    accountMovementInstanceReference: uuidv4(),
    accountArrangementInstanceReference: account.accountRef,
    movementKind: movement.kind,
    movementDirection: movement.direction,
    movementAmount: movement.amount,
    movementCurrency: account.currency,
    movementBalanceAfter: movement.balanceAfter,
    movementCorrelationId: movement.correlationId,
    movementRemittanceInformation: movement.remittanceInformation,
    movementValueDateTime: now,
    bianServiceDomain: 'Current Account',
    bianControlRecordType: 'AccountMovement',
    recordCreatedDateTime: now,
    schemaVersion: 1,
  };
  await db.collection<AccountMovementRecord>(ACCOUNT_MOVEMENT_COLLECTION).insertOne(record);
}

export interface LedgerOperation {
  accountRef: string;
  amount: number;
  currency: string;
  correlationId: string;
  remittanceInformation?: string;
}

// Debit spendable funds. Refused rather than overdrawn when the balance is short.
export async function debit(db: Db, op: LedgerOperation, kind: MovementKind = 'credit_transfer_debit'): Promise<LedgerResult> {
  const result = await applyIncrement(db, op.accountRef, { availableAmount: -op.amount }, { availableAmount: op.amount }, 'insufficient_funds');
  if (result.applied) {
    await recordMovement(db, { accountRef: op.accountRef, currency: op.currency }, {
      kind, direction: 'debit', amount: op.amount, balanceAfter: result.balanceAfter!,
      correlationId: op.correlationId, remittanceInformation: op.remittanceInformation,
    });
  }
  return result;
}

// Credit spendable funds. This is the bank's own act: a PSP crediting a beneficiary would be
// inventing money, which is one of the three defects this iteration closes.
export async function credit(db: Db, op: LedgerOperation, kind: MovementKind = 'credit_transfer_credit'): Promise<LedgerResult> {
  const result = await applyIncrement(db, op.accountRef, { availableAmount: op.amount }, {}, 'insufficient_funds');
  if (result.applied) {
    await recordMovement(db, { accountRef: op.accountRef, currency: op.currency }, {
      kind, direction: 'credit', amount: op.amount, balanceAfter: result.balanceAfter!,
      correlationId: op.correlationId, remittanceInformation: op.remittanceInformation,
    });
  }
  return result;
}

// Move spendable funds into reserved: a card authorisation hold or a dispute hold. The money is still
// the customer's, it is simply not spendable, so this is not a debit.
export async function reserve(db: Db, op: LedgerOperation, kind: MovementKind = 'card_authorisation_hold'): Promise<LedgerResult> {
  const result = await applyIncrement(
    db, op.accountRef,
    { availableAmount: -op.amount, reservedAmount: op.amount },
    { availableAmount: op.amount },
    'insufficient_funds',
  );
  if (result.applied) {
    await recordMovement(db, { accountRef: op.accountRef, currency: op.currency }, {
      kind, direction: 'debit', amount: op.amount, balanceAfter: result.balanceAfter!,
      correlationId: op.correlationId, remittanceInformation: op.remittanceInformation,
    });
  }
  return result;
}

// Give a reservation back. Guarded on the reserved balance, so a double release cannot mint funds.
export async function release(db: Db, op: LedgerOperation, kind: MovementKind = 'card_authorisation_release'): Promise<LedgerResult> {
  const result = await applyIncrement(
    db, op.accountRef,
    { availableAmount: op.amount, reservedAmount: -op.amount },
    { reservedAmount: op.amount },
    'insufficient_reserved',
  );
  if (result.applied) {
    await recordMovement(db, { accountRef: op.accountRef, currency: op.currency }, {
      kind, direction: 'credit', amount: op.amount, balanceAfter: result.balanceAfter!,
      correlationId: op.correlationId, remittanceInformation: op.remittanceInformation,
    });
  }
  return result;
}

// Settle a held card authorisation: the reservation leaves the account for good.
export async function settleReservation(db: Db, op: LedgerOperation): Promise<LedgerResult> {
  const result = await applyIncrement(db, op.accountRef, { reservedAmount: -op.amount }, { reservedAmount: op.amount }, 'insufficient_reserved');
  if (result.applied) {
    await recordMovement(db, { accountRef: op.accountRef, currency: op.currency }, {
      kind: 'card_settlement', direction: 'debit', amount: op.amount, balanceAfter: result.balanceAfter!,
      correlationId: op.correlationId, remittanceInformation: op.remittanceInformation,
    });
  }
  return result;
}

// Book an expected incoming amount, and later confirm or drop it.
export async function creditPending(db: Db, op: LedgerOperation): Promise<LedgerResult> {
  return applyIncrement(db, op.accountRef, { pendingAmount: op.amount }, {}, 'insufficient_pending');
}

export async function confirmPendingCredit(db: Db, op: LedgerOperation): Promise<LedgerResult> {
  const result = await applyIncrement(
    db, op.accountRef,
    { pendingAmount: -op.amount, availableAmount: op.amount },
    { pendingAmount: op.amount },
    'insufficient_pending',
  );
  if (result.applied) {
    await recordMovement(db, { accountRef: op.accountRef, currency: op.currency }, {
      kind: 'credit_transfer_credit', direction: 'credit', amount: op.amount, balanceAfter: result.balanceAfter!,
      correlationId: op.correlationId, remittanceInformation: op.remittanceInformation,
    });
  }
  return result;
}

// Drop an expected credit that will never arrive. availableAmount is deliberately NOT credited: the
// funds never landed, so crediting them would invent money.
export async function dropPendingCredit(db: Db, op: LedgerOperation): Promise<LedgerResult> {
  return applyIncrement(db, op.accountRef, { pendingAmount: -op.amount }, { pendingAmount: op.amount }, 'insufficient_pending');
}

// Book transfer between two accounts of this bank: on-us, no scheme involved. Debit first, so a
// refused debit never produces a credit, and compensate the debit if the credit cannot be applied.
export async function bookTransfer(
  db: Db,
  input: { debtorAccountRef: string; creditorAccountRef: string; amount: number; currency: string; correlationId: string; remittanceInformation?: string },
): Promise<LedgerResult> {
  const debited = await debit(db, { ...input, accountRef: input.debtorAccountRef }, 'book_transfer_debit');
  if (!debited.applied) return debited;

  const credited = await credit(db, { ...input, accountRef: input.creditorAccountRef }, 'book_transfer_credit');
  if (!credited.applied) {
    // Compensation, not a transaction: the saga pattern this platform already uses.
    await credit(db, { ...input, accountRef: input.debtorAccountRef, remittanceInformation: 'book transfer compensation' }, 'book_transfer_credit');
    return credited;
  }
  return credited;
}

// Demo credit, the bank side of the operation the PSP used to expose on its own accounts. It lives
// here because minting funds is something only the institution holding the account can do.
export async function demoCredit(
  db: Db,
  input: { accountRef: string; amount: number; currency: string; creditType?: CreditType; reason?: string; requestedBy?: string; correlationId?: string },
): Promise<LedgerResult> {
  const correlationId = input.correlationId ?? uuidv4();
  const result = await credit(db, { ...input, accountRef: input.accountRef, correlationId, remittanceInformation: input.reason }, 'demo_credit');
  if (!result.applied) return result;

  const now = new Date().toISOString();
  const entry: BalanceCreditLogEntry = {
    balanceCreditLogInstanceReference: uuidv4(),
    accountArrangementInstanceReference: input.accountRef,
    creditType: input.creditType ?? 'demo_credit',
    creditAmount: input.amount,
    creditCurrency: input.currency,
    creditBalanceAfter: result.balanceAfter!,
    creditReason: input.reason,
    creditRequestedBy: input.requestedBy,
    creditCorrelationId: correlationId,
    bianServiceDomain: 'Current Account',
    bianControlRecordType: 'BalanceCreditLog',
    recordCreatedDateTime: now,
    schemaVersion: 1,
  };
  await db.collection<BalanceCreditLogEntry>(BALANCE_CREDIT_LOG_COLLECTION).insertOne(entry);
  return result;
}

// v37 P2.1/P2.2: the bank's internal ledger. These are the mutators the PSP core used to own.
//
// The property under test is the one that makes a ledger trustworthy: every mutation is a single
// conditional update, so two concurrent debits cannot both pass their own check and overdraw the
// account, and a double release cannot mint funds.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import {
  debit, credit, reserve, release, settleReservation,
  creditPending, confirmPendingCredit, dropPendingCredit, bookTransfer, demoCredit,
} from '../../../bankcore/src/modules/aspsp/services/ledger.service';

interface Account {
  accountArrangementInstanceReference: string;
  accountStatus: string;
  accountBalance: { availableAmount: number; pendingAmount: number; reservedAmount: number; currency: string; lastUpdatedDateTime: Date | string };
}

// Minimal in-memory stand-in for the driver, honouring exactly what the ledger relies on:
// findOneAndUpdate with a $gte guard inside the filter, and $inc on dotted balance paths.
function fakeDb(accounts: Account[]) {
  const movements: Array<Record<string, unknown>> = [];
  const creditLog: Array<Record<string, unknown>> = [];

  const matches = (doc: Account, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([key, expected]) => {
      const actual = key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], doc);
      if (expected && typeof expected === 'object' && '$gte' in (expected as object)) {
        return typeof actual === 'number' && actual >= (expected as { $gte: number }).$gte;
      }
      return actual === expected;
    });

  const collection = (name: string) => ({
    async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) {
      const doc = accounts.find((a) => matches(a, filter));
      if (!doc) return null;
      for (const [path, delta] of Object.entries(update.$inc ?? {})) {
        const [, field] = path.split('.');
        (doc.accountBalance as unknown as Record<string, number>)[field] += delta as number;
      }
      return doc;
    },
    async countDocuments(filter: Record<string, unknown>) {
      return accounts.filter((a) => matches(a, filter)).length;
    },
    async insertOne(doc: Record<string, unknown>) {
      (name === 'accountMovement' ? movements : creditLog).push(doc);
      return { acknowledged: true };
    },
  });

  return { db: { collection } as unknown as Db, movements, creditLog };
}

const OP = { amount: 100, currency: 'EUR', correlationId: 'TRF-LEDGER-TEST' };

function account(ref: string, available: number, reserved = 0, pending = 0): Account {
  return {
    accountArrangementInstanceReference: ref,
    accountStatus: 'active',
    accountBalance: { availableAmount: available, pendingAmount: pending, reservedAmount: reserved, currency: 'EUR', lastUpdatedDateTime: new Date() },
  };
}

describe('v37 P2.2: bank ledger operations', () => {
  let accounts: Account[];
  let ctx: ReturnType<typeof fakeDb>;

  beforeEach(() => {
    accounts = [account('ACC-1', 500), account('ACC-2', 50, 20, 30)];
    ctx = fakeDb(accounts);
  });

  it('debits and records the movement with the balance after it', async () => {
    const result = await debit(ctx.db, { ...OP, accountRef: 'ACC-1' });
    expect(result).toMatchObject({ applied: true, balanceAfter: 400 });
    expect(ctx.movements).toHaveLength(1);
    expect(ctx.movements[0]).toMatchObject({ movementDirection: 'debit', movementAmount: 100, movementBalanceAfter: 400 });
  });

  it('refuses a debit beyond the available balance instead of overdrawing', async () => {
    const result = await debit(ctx.db, { ...OP, amount: 600, accountRef: 'ACC-1' });
    expect(result).toMatchObject({ applied: false, reason: 'insufficient_funds' });
    expect(accounts[0].accountBalance.availableAmount).toBe(500);
    // A refused debit records no movement: the ledger only states what happened.
    expect(ctx.movements).toHaveLength(0);
  });

  it('distinguishes an unknown or inactive account from a refused guard', async () => {
    expect(await debit(ctx.db, { ...OP, accountRef: 'ACC-NOPE' }))
      .toMatchObject({ applied: false, reason: 'account_not_found_or_inactive' });
    accounts[0].accountStatus = 'blocked';
    expect(await debit(ctx.db, { ...OP, accountRef: 'ACC-1' }))
      .toMatchObject({ applied: false, reason: 'account_not_found_or_inactive' });
  });

  it('credits, which is the bank\'s act and never the PSP\'s', async () => {
    const result = await credit(ctx.db, { ...OP, accountRef: 'ACC-2' });
    expect(result).toMatchObject({ applied: true, balanceAfter: 150 });
  });

  it('a reservation moves funds out of spendable without leaving the account', async () => {
    await reserve(ctx.db, { ...OP, accountRef: 'ACC-1' });
    expect(accounts[0].accountBalance.availableAmount).toBe(400);
    expect(accounts[0].accountBalance.reservedAmount).toBe(100);
  });

  it('a release is guarded on the reserved balance, so a double release cannot mint funds', async () => {
    await reserve(ctx.db, { ...OP, accountRef: 'ACC-1' });
    expect(await release(ctx.db, { ...OP, accountRef: 'ACC-1' })).toMatchObject({ applied: true });
    expect(await release(ctx.db, { ...OP, accountRef: 'ACC-1' }))
      .toMatchObject({ applied: false, reason: 'insufficient_reserved' });
    expect(accounts[0].accountBalance.availableAmount).toBe(500);
    expect(accounts[0].accountBalance.reservedAmount).toBe(0);
  });

  it('settling a reservation takes it out of the account for good', async () => {
    await reserve(ctx.db, { ...OP, accountRef: 'ACC-1' });
    await settleReservation(ctx.db, { ...OP, accountRef: 'ACC-1' });
    expect(accounts[0].accountBalance.availableAmount).toBe(400);
    expect(accounts[0].accountBalance.reservedAmount).toBe(0);
  });

  it('an expected credit is confirmed out of pending, not invented', async () => {
    await creditPending(ctx.db, { ...OP, accountRef: 'ACC-1' });
    expect(accounts[0].accountBalance.pendingAmount).toBe(100);
    await confirmPendingCredit(ctx.db, { ...OP, accountRef: 'ACC-1' });
    expect(accounts[0].accountBalance).toMatchObject({ availableAmount: 600, pendingAmount: 0 });
  });

  it('a credit that never arrives is dropped from pending and never lands in available', async () => {
    await creditPending(ctx.db, { ...OP, accountRef: 'ACC-1' });
    await dropPendingCredit(ctx.db, { ...OP, accountRef: 'ACC-1' });
    expect(accounts[0].accountBalance).toMatchObject({ availableAmount: 500, pendingAmount: 0 });
  });

  it('an on-us book transfer debits and credits in one operation', async () => {
    const result = await bookTransfer(ctx.db, {
      debtorAccountRef: 'ACC-1', creditorAccountRef: 'ACC-2',
      amount: 100, currency: 'EUR', correlationId: 'TRF-ONUS',
    });
    expect(result.applied).toBe(true);
    expect(accounts[0].accountBalance.availableAmount).toBe(400);
    expect(accounts[1].accountBalance.availableAmount).toBe(150);
    expect(ctx.movements.map((m) => m.movementKind)).toEqual(['book_transfer_debit', 'book_transfer_credit']);
  });

  it('a book transfer whose credit fails compensates the debit', async () => {
    const result = await bookTransfer(ctx.db, {
      debtorAccountRef: 'ACC-1', creditorAccountRef: 'ACC-CLOSED',
      amount: 100, currency: 'EUR', correlationId: 'TRF-ONUS-FAIL',
    });
    expect(result.applied).toBe(false);
    // Compensation, not a distributed transaction: the debtor ends where it started.
    expect(accounts[0].accountBalance.availableAmount).toBe(500);
  });

  it('a book transfer with an insufficient debtor never credits the creditor', async () => {
    const result = await bookTransfer(ctx.db, {
      debtorAccountRef: 'ACC-2', creditorAccountRef: 'ACC-1',
      amount: 5000, currency: 'EUR', correlationId: 'TRF-ONUS-SHORT',
    });
    expect(result).toMatchObject({ applied: false, reason: 'insufficient_funds' });
    expect(accounts[0].accountBalance.availableAmount).toBe(500);
  });

  it('the demo credit is the bank\'s operation and writes its audit entry', async () => {
    const result = await demoCredit(ctx.db, { accountRef: 'ACC-1', amount: 250, currency: 'EUR', reason: 'demo top-up', requestedBy: 'operations_officer' });
    expect(result).toMatchObject({ applied: true, balanceAfter: 750 });
    expect(ctx.creditLog).toHaveLength(1);
    expect(ctx.creditLog[0]).toMatchObject({ creditType: 'demo_credit', creditAmount: 250, creditBalanceAfter: 750, creditRequestedBy: 'operations_officer' });
  });
});

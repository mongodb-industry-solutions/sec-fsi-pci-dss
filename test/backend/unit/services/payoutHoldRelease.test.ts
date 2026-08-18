/**
 * Unit tests (v34): the payout saga never leaves a reservation behind.
 * Source: backend/src/modules/gateway/services/payoutAccountBalance.service.ts (releasePendingCredit)
 *
 * At authorization the merchant's incoming amount is reserved (debitPending). Every path that ends
 * without a settlement has to give that reservation back, or the beneficiary keeps an incoming credit
 * that can never arrive. The reversal must NOT credit availableAmount: the funds never landed, so
 * crediting them would invent money. That is what separates it from releaseReservation, which returns a
 * sender's own funds.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  debitPending,
  releasePendingCredit,
  releaseReservation,
} from '../../../../backend/src/modules/gateway/services/payoutAccountBalance.service';

function makeDb() {
  const calls: { filter: Record<string, unknown>; inc: Record<string, number> }[] = [];
  const db = {
    collection: vi.fn(() => ({
      updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $inc?: Record<string, number> }) => {
        calls.push({ filter, inc: update.$inc ?? {} });
        return { modifiedCount: 1 };
      }),
    })),
  } as any;
  return { db, calls };
}

describe('releasePendingCredit', () => {
  it('is the exact inverse of debitPending', async () => {
    const { db, calls } = makeDb();
    await debitPending(db, 'pao-1', 39);
    await releasePendingCredit(db, 'pao-1', 39);

    const net = calls.reduce((sum, c) => sum + (c.inc['payoutAccountBalance.pendingAmount'] ?? 0), 0);
    expect(net).toBe(0); // the reservation is fully given back
  });

  it('does not credit availableAmount: the funds never arrived', async () => {
    const { db, calls } = makeDb();
    await releasePendingCredit(db, 'pao-1', 39);

    expect(calls[0].inc['payoutAccountBalance.pendingAmount']).toBe(-39);
    expect(calls[0].inc['payoutAccountBalance.availableAmount']).toBeUndefined();
  });

  it('differs from releaseReservation, which returns a sender its own funds', async () => {
    const { db, calls } = makeDb();
    await releaseReservation(db, 'pao-1', 39);

    // A P2P sender gets the money back into available; a payout beneficiary must not.
    expect(calls[0].inc['payoutAccountBalance.availableAmount']).toBe(39);
  });

  it('only touches an active account (a closed one cannot be mutated silently)', async () => {
    const { db, calls } = makeDb();
    await releasePendingCredit(db, 'pao-1', 39);

    expect(calls[0].filter).toMatchObject({
      payoutAccountInstanceReference: 'pao-1',
      payoutAccountStatus: 'active',
    });
  });
});

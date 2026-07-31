/**
 * Unit tests: merchant-commission posting (SD-89 pricing → SD-66 balances).
 * Source: backend/src/modules/gateway/services/commissionSettlement.service.ts
 *
 * The commission is withheld from the gross, so collecting it must move money in TWO legs:
 * the merchant hold shrinks and the PSP revenue account grows by the same amount. A zero fee must
 * move nothing at all, and a replayed settlement must not collect twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitProcessEvent: vi.fn(),
}));

import {
  postCommission,
  PSP_REVENUE_ACCOUNT_REFERENCE,
} from '../../../../backend/src/modules/gateway/services/commissionSettlement.service';

const REVENUE_ACCOUNT = {
  payoutAccountInstanceReference: PSP_REVENUE_ACCOUNT_REFERENCE,
  payoutAccountCurrency: 'EUR',
};

// Minimal Db double: records every $inc on payoutAccountArrangement so both legs can be asserted.
function makeDb(opts: { revenueAccount?: unknown; alreadyCollected?: boolean } = {}) {
  const incs: { ref: string; inc: Record<string, number> }[] = [];
  const creditLogUpsert = vi.fn().mockResolvedValue({ upsertedCount: opts.alreadyCollected ? 0 : 1 });
  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'payoutAccountArrangement') {
        return {
          findOne: vi.fn().mockResolvedValue('revenueAccount' in opts ? opts.revenueAccount : REVENUE_ACCOUNT),
          updateOne: vi.fn(async (filter: Record<string, string>, update: { $inc?: Record<string, number> }) => {
            incs.push({ ref: filter.payoutAccountInstanceReference, inc: update.$inc ?? {} });
            return { modifiedCount: 1 };
          }),
        };
      }
      return { updateOne: creditLogUpsert }; // balanceCreditLog
    }),
  } as any;
  return { db, incs, creditLogUpsert };
}

const input = {
  executionRef: 'e-1',
  merchantReference: 'm-1',
  merchantAccountRef: 'pao-1',
  feeAmount: 5,
  currency: 'EUR',
  feeRateApplied: 0.025,
};

describe('postCommission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts both legs: merchant pending down, PSP revenue up, same amount', async () => {
    const { db, incs } = makeDb();
    const { outcome, creditedAmount } = await postCommission(db, input);

    expect(outcome).toBe('posted');
    expect(creditedAmount).toBe(5);
    const merchantLeg = incs.find((i) => i.ref === 'pao-1');
    const pspLeg = incs.find((i) => i.ref === PSP_REVENUE_ACCOUNT_REFERENCE);
    expect(merchantLeg?.inc['payoutAccountBalance.pendingAmount']).toBe(-5);
    expect(pspLeg?.inc['payoutAccountBalance.availableAmount']).toBe(5);
  });

  it('writes an auditable credit-log entry keyed by the execution (PCI DSS Req 10)', async () => {
    const { db, creditLogUpsert } = makeDb();
    await postCommission(db, input);

    const [filter, update] = creditLogUpsert.mock.calls[0];
    expect(filter).toEqual({ creditId: 'commission-e-1' });
    expect(update.$setOnInsert.creditType).toBe('commission');
    expect(update.$setOnInsert.referenceId).toBe('e-1');
    expect(update.$setOnInsert.amount).toBe(5);
  });

  it('moves nothing for a zero fee (gross == net stays balanced)', async () => {
    const { db, incs, creditLogUpsert } = makeDb();
    expect(await postCommission(db, { ...input, feeAmount: 0 })).toEqual({ outcome: 'zero_fee', creditedAmount: 0 });
    expect(incs).toHaveLength(0);
    expect(creditLogUpsert).not.toHaveBeenCalled();
  });

  it('is idempotent: a replayed settlement collects nothing more', async () => {
    const { db, incs } = makeDb({ alreadyCollected: true });
    // 'already_collected' tells the caller NOT to compensate: an earlier run already withheld the fee.
    expect(await postCommission(db, input)).toEqual({ outcome: 'already_collected', creditedAmount: 0 });
    expect(incs).toHaveLength(0); // credit-log upsert lost the race → no balance movement
  });

  it('leaves the merchant hold untouched when the revenue account is missing', async () => {
    const { db, incs } = makeDb({ revenueAccount: null });
    // The caller compensates on this outcome, so the fee is released to the merchant instead of
    // being stranded in its pending hold.
    expect(await postCommission(db, input)).toEqual({ outcome: 'no_revenue_account', creditedAmount: 0 });
    expect(incs).toHaveLength(0); // never debit one leg without the other
  });
});

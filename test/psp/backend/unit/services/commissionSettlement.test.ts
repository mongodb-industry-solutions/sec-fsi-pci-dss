/**
 * Unit tests: merchant-commission posting (pricing → balances).
 * Source: backend/src/modules/gateway/services/commissionSettlement.service.ts
 *
 * The commission is withheld from the gross, so collecting it must move money in TWO legs:
 * the merchant hold shrinks and the PSP revenue account grows by the same amount. A zero fee must
 * move nothing at all, and a replayed settlement must not collect twice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../psp/backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitProcessEvent: vi.fn(),
}));

const resolveAndConvert = vi.fn();
vi.mock('../../../../../psp/backend/src/providers/currency-exchange/services/currencyExchange.service', () => ({
  resolveAndConvert: (...args: unknown[]) => resolveAndConvert(...args),
}));

import {
  postCommission,
  requiresFeeRelease,
  PSP_REVENUE_ACCOUNT_REFERENCE,
} from '../../../../../psp/backend/src/modules/gateway/services/commissionSettlement.service';

const REVENUE_ACCOUNT = {
  payoutAccountInstanceReference: PSP_REVENUE_ACCOUNT_REFERENCE,
  payoutAccountCurrency: 'EUR',
  payoutAccountStatus: 'active',
};

// Minimal Db double: records every $inc on payoutAccountArrangement so both legs can be asserted.
function makeDb(opts: { revenueAccount?: unknown; alreadyCollected?: boolean } = {}) {
  const incs: { ref: string; inc: Record<string, number> }[] = [];
  // v37: the guard is the idempotency store, not the balance credit log. The log is the bank's, and using
  // an audit row as a lock meant a bank-side change could silently double-collect the fee.
  const claimUpsert = vi.fn().mockResolvedValue({ upsertedCount: opts.alreadyCollected ? 0 : 1 });
  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'payoutAccountArrangement') {
        return {
          // Honours the status condition, so "the account exists but cannot be credited" is a real
          // case here and not just an assertion about the query shape.
          findOne: vi.fn(async (filter: Record<string, unknown>) => {
            const account = 'revenueAccount' in opts ? (opts.revenueAccount as any) : REVENUE_ACCOUNT;
            if (!account) return null;
            return filter.payoutAccountStatus && account.payoutAccountStatus !== filter.payoutAccountStatus ? null : account;
          }),
          updateOne: vi.fn(async (filter: Record<string, string>, update: { $inc?: Record<string, number> }) => {
            incs.push({ ref: filter.payoutAccountInstanceReference, inc: update.$inc ?? {} });
            return { modifiedCount: 1 };
          }),
        };
      }
      return { updateOne: claimUpsert }; // idempotencyKey
    }),
  } as any;
  return { db, incs, claimUpsert };
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

  it('claims the execution once, atomically, keyed by the execution reference', async () => {
    // The fee must be collected at most once. The claim is an upsert on a unique key, so the FIRST caller
    // wins under a race; the audit of the credit itself is the bank's, because the bank owns the balance.
    const { db, claimUpsert } = makeDb();
    await postCommission(db, input);

    const [filter, update, options] = claimUpsert.mock.calls[0];
    expect(filter.idempotencyKey).toContain('commission-e-1');
    expect(filter.idempotencyKey).toContain('commission.settlement');
    expect(update.$setOnInsert.scope).toBe('commission.settlement');
    expect(options).toEqual({ upsert: true });
  });

  it('moves nothing for a zero fee (gross == net stays balanced)', async () => {
    const { db, incs, claimUpsert } = makeDb();
    expect(await postCommission(db, { ...input, feeAmount: 0 })).toEqual({ outcome: 'zero_fee', creditedAmount: 0 });
    expect(incs).toHaveLength(0);
    expect(claimUpsert).not.toHaveBeenCalled();
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

  it('posts nothing when the revenue account exists but is not active', async () => {
    const { db, incs, claimUpsert } = makeDb({ revenueAccount: { ...REVENUE_ACCOUNT, payoutAccountStatus: 'suspended' } });
    // creditDirect only mutates an active account, so accepting a suspended one would debit the
    // merchant hold and log a credit for a leg that never lands.
    expect(await postCommission(db, input)).toEqual({ outcome: 'no_revenue_account', creditedAmount: 0 });
    expect(incs).toHaveLength(0);
    expect(claimUpsert).not.toHaveBeenCalled();
  });

  it('credits the revenue account in ITS currency when the fee is in another one', async () => {
    const { db, incs, claimUpsert } = makeDb({ revenueAccount: { ...REVENUE_ACCOUNT, payoutAccountCurrency: 'USD' } });
    resolveAndConvert.mockResolvedValue({ amount: 5.4 });

    expect(await postCommission(db, input)).toEqual({ outcome: 'posted', creditedAmount: 5.4 });
    // The merchant leg clears the hold in the merchant's currency, the PSP leg lands in USD.
    expect(incs.find((i) => i.ref === 'pao-1')?.inc['payoutAccountBalance.pendingAmount']).toBe(-5);
    expect(incs.find((i) => i.ref === PSP_REVENUE_ACCOUNT_REFERENCE)?.inc['payoutAccountBalance.availableAmount']).toBe(5.4);
    // The claim is keyed by the EXECUTION, not by the amount: a retry after a rate change must not collect
    // a second time just because the converted figure differs.
    expect(claimUpsert.mock.calls[0][0].idempotencyKey).toContain('commission-e-1');
  });

  it('posts nothing when the fee cannot be converted, rather than crediting the wrong units', async () => {
    const { db, incs, claimUpsert } = makeDb({ revenueAccount: { ...REVENUE_ACCOUNT, payoutAccountCurrency: 'USD' } });
    resolveAndConvert.mockRejectedValue(new Error('no rate'));

    // Falling back to the unconverted amount would credit 5 EUR of value as 5 USD and log it as USD.
    expect(await postCommission(db, input)).toEqual({ outcome: 'fx_unavailable', creditedAmount: 0 });
    expect(incs).toHaveLength(0);
    expect(claimUpsert).not.toHaveBeenCalled();
  });
});

describe('requiresFeeRelease', () => {
  it('is true exactly for the outcomes that leave the fee in the merchant hold', () => {
    expect(requiresFeeRelease('no_revenue_account')).toBe(true);
    expect(requiresFeeRelease('fx_unavailable')).toBe(true);
    // A collected fee (now or on an earlier run) must not be handed back a second time.
    expect(requiresFeeRelease('posted')).toBe(false);
    expect(requiresFeeRelease('already_collected')).toBe(false);
    expect(requiresFeeRelease('zero_fee')).toBe(false);
  });
});

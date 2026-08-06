/**
 * Unit tests (v18 Item 1: A-06/A-07): merchant commission fee.
 * Source: backend/src/modules/gateway/services/paymentExecution.service.ts (computeFee, resolveMerchantFee)
 *
 * computeFee is the single source of the commission calculation (DRY) reused by BOTH the payout
 * execution path (SD-65) and the runtime acquiring card-payment path (SD-254). resolveMerchantFee
 * turns the merchant's CURRENT rate into the gross/net/fee triple an execution is born with, so the
 * stored amounts and the balance movements can never disagree.
 */
import { describe, it, expect, vi } from 'vitest';
import { computeFee, resolveMerchantFee } from '../../../../backend/src/modules/gateway/services/paymentExecution.service';

describe('computeFee', () => {
  it('applies rate·amount rounded to 2 decimals and records attribution', () => {
    const { feeAmount, feeCurrency, fee } = computeFee(149, 0.025, 'GBP', 'm-1');
    expect(feeAmount).toBe(3.73); // 149 * 0.025 = 3.725 → 3.73
    expect(feeCurrency).toBe('GBP');
    expect(fee.feeMerchantReference).toBe('m-1');
    expect(fee.feeRateApplied).toBe(0.025);
    expect(fee.feeCollectedDateTime).toBeInstanceOf(Date);
  });

  it('yields a zero fee for a missing or out-of-range rate (no revenue attributed)', () => {
    expect(computeFee(100, undefined, 'GBP', 'm-1').feeAmount).toBe(0);
    expect(computeFee(100, 0, 'GBP', 'm-1').feeAmount).toBe(0);
    expect(computeFee(100, 1.5, 'GBP', 'm-1').feeAmount).toBe(0); // > 1 rejected
    expect(computeFee(100, -0.1, 'GBP', 'm-1').feeAmount).toBe(0);
  });
});

describe('resolveMerchantFee', () => {
  const makeDb = (rate?: number) => ({
    collection: vi.fn(() => ({
      findOne: vi.fn().mockResolvedValue(rate === undefined ? null : { merchantCommissionRate: rate }),
    })),
  }) as any;

  it('withholds the fee from the gross: net = gross − fee', async () => {
    const res = await resolveMerchantFee(makeDb(0.025), 'm-1', 200, 'GBP');
    expect(res.feeAmount).toBe(5); // 200 * 0.025
    expect(res.netAmount).toBe(195);
    expect(res.fee?.feeRateApplied).toBe(0.025);
  });

  it('never inflates the gross (the buyer is not charged the commission)', async () => {
    const res = await resolveMerchantFee(makeDb(0.03), 'm-1', 50, 'EUR');
    expect(res.feeAmount + res.netAmount).toBe(50);
  });

  it('defaults to a zero fee with no attribution when the merchant has no rate', async () => {
    const res = await resolveMerchantFee(makeDb(undefined), 'm-1', 200, 'GBP');
    expect(res.feeAmount).toBe(0);
    expect(res.netAmount).toBe(200); // gross == net keeps the ledger balanced
    expect(res.fee).toBeUndefined();  // sparse: zero-fee executions are not counted as revenue
  });

  it('rounds net to 2 decimals so no float artifact reaches a balance', async () => {
    const res = await resolveMerchantFee(makeDb(0.025), 'm-1', 10.1, 'EUR');
    expect(res.feeAmount).toBe(0.25);
    expect(res.netAmount).toBe(9.85);
  });
});

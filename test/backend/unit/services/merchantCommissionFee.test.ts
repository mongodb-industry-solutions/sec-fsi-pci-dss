/**
 * Unit tests (v18 Item 1 — A-06/A-07): merchant commission fee.
 * Source: backend/src/modules/gateway/services/paymentExecution.service.ts (computeFee, applyMerchantFee)
 *
 * computeFee is the single source of the commission calculation (DRY) reused by BOTH the payout
 * execution path (SD-65) and the runtime acquiring card-payment path (SD-254). applyMerchantFee is
 * the idempotent execution-side application: a second call for the same merchant is a no-op.
 */
import { describe, it, expect, vi } from 'vitest';
import { computeFee, applyMerchantFee } from '../../../../backend/src/modules/gateway/services/paymentExecution.service';

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

describe('applyMerchantFee (idempotent)', () => {
  const makeDb = (exec: Record<string, unknown>, rate?: number) => {
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const collection = vi.fn((name: string) => {
      if (name === 'paymentExecutionProcedure') {
        return { findOne: vi.fn().mockResolvedValue(exec), updateOne };
      }
      // merchantAgreementProcedure
      return { findOne: vi.fn().mockResolvedValue(rate === undefined ? null : { merchantCommissionRate: rate }) };
    });
    return { db: { collection } as any, updateOne };
  };

  it('computes and persists the fee from the merchant CURRENT rate', async () => {
    const { db, updateOne } = makeDb({ paymentExecutionInstanceReference: 'e-1', grossAmount: 200, currency: 'GBP' }, 0.025);
    const fee = await applyMerchantFee(db, 'e-1', 'm-1');
    expect(fee?.feeRateApplied).toBe(0.025);
    expect(updateOne).toHaveBeenCalledTimes(1);
    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.feeAmount).toBe(5); // 200 * 0.025
    expect(setArg.netAmount).toBe(195);
  });

  it('is a no-op when the same merchant fee is already attributed', async () => {
    const { db, updateOne } = makeDb(
      { paymentExecutionInstanceReference: 'e-1', grossAmount: 200, currency: 'GBP', fee: { feeMerchantReference: 'm-1' } },
      0.025,
    );
    const fee = await applyMerchantFee(db, 'e-1', 'm-1');
    expect(fee).toEqual({ feeMerchantReference: 'm-1' });
    expect(updateOne).not.toHaveBeenCalled(); // idempotent → not charged twice
  });
});

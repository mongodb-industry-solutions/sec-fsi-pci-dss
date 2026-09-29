// v37 P5.2/P5.5/P5.7: the same-owner transfer, and the two classifications that used to be silent guesses.
//
// The gate for P5 asks for tests on the same-owner transfer and a test that no recipient credit happens at
// the PSP. The second lives in `pspStopsMovingMoney.test.ts`; this covers the first, plus the product
// selection, which is the PSP's own derivation and the one piece of routing that legitimately stays here.
import { describe, it, expect } from 'vitest';
import { selectPaymentProduct } from '../../../../../psp/backend/src/providers/payment-initiation/services/bankcorePis.client';
import { movementMethod } from '../../../../../psp/backend/src/modules/gateway/services/paymentMovement.service';
import { convert, DEFAULT_CURRENCY_EXCHANGE_CONFIG } from '../../../../../psp/backend/src/providers/currency-exchange/services/currencyExchange.service';

describe('v37 P5.1: the PSP selects the payment PRODUCT, never the execution rail', () => {
  it('picks SEPA for a euro transfer and cross-border otherwise', () => {
    expect(selectPaymentProduct({ currency: 'EUR' })).toBe('sepa-credit-transfers');
    expect(selectPaymentProduct({ currency: 'eur' })).toBe('sepa-credit-transfers');
    // Not a euro amount: the corridor is cross-border whoever the beneficiary banks with.
    expect(selectPaymentProduct({ currency: 'USD' })).toBe('cross-border-credit-transfers');
    expect(selectPaymentProduct({ currency: 'NGN' })).toBe('cross-border-credit-transfers');
  });

  it('asks for instant only when instant was asked for', () => {
    expect(selectPaymentProduct({ currency: 'EUR', instant: true })).toBe('instant-sepa-credit-transfers');
    // A non-euro instant request is still cross-border: SCT Inst is a euro scheme.
    expect(selectPaymentProduct({ currency: 'USD', instant: true })).toBe('cross-border-credit-transfers');
  });

  it('does not vary by which bank holds the destination', () => {
    // The product is about the CORRIDOR. If this ever branched on an institution, a second registered bank
    // would need a code change, which is the property the whole design is protecting.
    const withCountry = selectPaymentProduct({ currency: 'EUR', creditorCountryCode: 'DE' });
    const withoutCountry = selectPaymentProduct({ currency: 'EUR' });
    expect(withCountry).toBe(withoutCountry);
  });
});

describe('v37 P5.5: a same-owner movement is classified as itself', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    kind: 'transfer',
    paymentExecutionRail: 'sepa',
    ...over,
  } as never);

  it('reads the classification from the execution rather than guessing from the rail', () => {
    expect(movementMethod(row({ movementMethodOverride: 'same_owner_transfer' }))).toBe('same_owner');
    // A rail cannot tell you whose accounts are at either end, which is why the guess was the defect.
    expect(movementMethod(row({ movementMethodOverride: 'same_owner_transfer', paymentExecutionRail: 'swift' })))
      .toBe('same_owner');
  });

  it('still classifies an ordinary transfer by its rail', () => {
    expect(movementMethod(row())).toBe('bank');
    expect(movementMethod(row({ paymentExecutionRail: 'internal_wallet' }))).toBe('p2p');
  });

  it('is unaffected for a card movement', () => {
    expect(movementMethod({ kind: 'card', acceptanceMethod: 'payment_link' } as never)).toBe('payment_link');
  });
});

describe('v37 P5.7: a cross-currency transfer converts through the exchange capability', () => {
  it('converts with the spread applied against the customer', () => {
    const result = convert(100, 'EUR', 'USD', DEFAULT_CURRENCY_EXCHANGE_CONFIG);
    expect(result.converted).toBe(true);
    // 1.08 mid plus 50 bps: the margin widens the rate against the customer, never in their favour.
    expect(result.rate).toBeGreaterThan(1.08);
    expect(result.amount).toBeGreaterThan(108);
  });

  it('is a no-op for the same currency, which is the common case', () => {
    const result = convert(100, 'EUR', 'EUR', DEFAULT_CURRENCY_EXCHANGE_CONFIG);
    expect(result).toMatchObject({ amount: 100, rate: 1, converted: false });
  });

  it('throws on a currency it has no rate for, rather than inventing one', () => {
    // A fabricated rate would move a real amount of money by a made-up factor. Failing is the safe answer.
    expect(() => convert(100, 'EUR', 'JPY', DEFAULT_CURRENCY_EXCHANGE_CONFIG)).toThrow(/missing rate/);
  });

  it('the defaults are now SEEDED, so the margin is editable rather than compiled in', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const seeds = JSON.parse(readFileSync(
      resolve(__dirname, '../../../../../psp/backend/data/capabilityModuleConfiguration.json'), 'utf8',
    )) as Array<{ capability: string; moduleConfig?: Record<string, unknown> }>;
    const fx = seeds.find((entry) => entry.capability === 'currency-exchange');
    expect(fx, 'currency-exchange had an enum entry but no seeded configuration').toBeDefined();
    expect(fx!.moduleConfig?.spreadBps).toBe(DEFAULT_CURRENCY_EXCHANGE_CONFIG.spreadBps);
    expect((fx!.moduleConfig?.rates as Record<string, number>).USD)
      .toBe(DEFAULT_CURRENCY_EXCHANGE_CONFIG.rates.USD);
  });
});

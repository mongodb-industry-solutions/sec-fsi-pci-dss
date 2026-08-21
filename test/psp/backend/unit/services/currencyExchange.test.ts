/**
 * Unit tests (v17): builtin Currency Exchange module. Pure conversion with mid cross-rate + spread.
 */
import { describe, it, expect } from 'vitest';
import {
  convert,
  resolveCurrencyExchangeConfig,
  DEFAULT_CURRENCY_EXCHANGE_CONFIG,
} from '../../../../../psp/backend/src/providers/currency-exchange/services/currencyExchange.service';

describe('currencyExchange.convert', () => {
  it('is a no-op for same currency (rate 1, converted=false)', () => {
    const r = convert(100, 'EUR', 'EUR');
    expect(r).toEqual({ amount: 100, rate: 1, converted: false });
  });

  it('applies the mid cross-rate plus spread when converting', () => {
    // EUR->USD mid = 1.08; spread 50bps => 1.08 * 1.005 = 1.0854
    const r = convert(100, 'EUR', 'USD');
    expect(r.converted).toBe(true);
    expect(r.rate).toBeCloseTo(1.0854, 4);
    expect(r.amount).toBeCloseTo(108.54, 2);
  });

  it('converts symmetrically through the base currency (USD->GBP)', () => {
    // mid = rate[GBP]/rate[USD] = 0.85/1.08; * 1.005 spread
    const mid = 0.85 / 1.08;
    const r = convert(200, 'USD', 'GBP');
    expect(r.rate).toBeCloseTo(mid * 1.005, 6);
    expect(r.amount).toBeCloseTo(Math.round(200 * mid * 1.005 * 100) / 100, 2);
  });

  it('throws on an unknown currency', () => {
    expect(() => convert(100, 'EUR', 'XYZ')).toThrow(/missing rate/);
  });

  it('rounds to 2 decimals (minor-unit precision)', () => {
    const r = convert(33.333, 'EUR', 'USD');
    expect(Number.isInteger(r.amount * 100)).toBe(true);
  });
});

describe('resolveCurrencyExchangeConfig', () => {
  it('falls back to defaults when nothing stored', () => {
    expect(resolveCurrencyExchangeConfig(undefined)).toEqual(DEFAULT_CURRENCY_EXCHANGE_CONFIG);
  });

  it('merges stored rates over defaults and honors a custom spread', () => {
    const cfg = resolveCurrencyExchangeConfig({ rates: { USD: 1.2 }, spreadBps: 0 });
    expect(cfg.rates.USD).toBe(1.2);
    expect(cfg.rates.EUR).toBe(1); // default preserved
    expect(cfg.spreadBps).toBe(0);
    // With zero spread the rate equals the mid.
    expect(convert(100, 'EUR', 'USD', cfg).rate).toBeCloseTo(1.2, 6);
  });
});

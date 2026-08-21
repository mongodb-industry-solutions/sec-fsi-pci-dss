/**
 * Unit tests: frontend/src/lib/money.ts
 * Intl.NumberFormat throws on a missing or unknown currency code, which blanked a whole page when a
 * movement arrived without one. Formatting must degrade, never throw.
 */
import { describe, it, expect } from 'vitest';
import { formatAmount } from '../../../../../psp/frontend/src/lib/money';

describe('formatAmount', () => {
  it('formats a normal amount with its currency', () => {
    expect(formatAmount(1234.5, 'EUR')).toContain('1,234.50');
    expect(formatAmount(10, 'USD')).toBe('$10.00');
  });

  it('never throws when the currency is missing or malformed', () => {
    for (const currency of [undefined, null, '', '  ', 'E', 'EURO', '123', 'eu-r']) {
      expect(() => formatAmount(42, currency)).not.toThrow();
    }
    expect(formatAmount(42, undefined)).toBe('42.00');
    expect(formatAmount(42, 'EURO')).toBe('42.00');
  });

  it('accepts a lowercase code, the same money either way', () => {
    expect(formatAmount(10, 'usd')).toBe(formatAmount(10, 'USD'));
  });

  it('treats a missing or non-finite amount as zero rather than rendering NaN', () => {
    expect(formatAmount(undefined, 'EUR')).toContain('0.00');
    expect(formatAmount(null, 'EUR')).toContain('0.00');
    expect(formatAmount(Number.NaN, 'EUR')).toContain('0.00');
    expect(formatAmount(Number.POSITIVE_INFINITY, 'EUR')).toContain('0.00');
  });

  it('honours the caller locale and number options', () => {
    expect(formatAmount(1234.5, 'GBP', { locale: 'en-GB' })).toContain('1,234.50');
    expect(formatAmount(1234.567, 'EUR', { maximumFractionDigits: 0 })).not.toContain('.');
  });
});

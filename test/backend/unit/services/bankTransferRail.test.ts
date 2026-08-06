// v17.1 Bank Transfer rail engine: unit tests (validators + RailResolver + FeeCalculator).
import {
  isValidIban, isValidBic, isValidRoutingNumber,
  RailResolver, UnsupportedCorridorError, FeeCalculator, DEFAULT_FEE_SCHEDULE,
  type RailDestination,
} from '../../../../backend/src/shared/services/bankTransfer';

describe('bankValidators', () => {
  test('IBAN mod-97 accepts valid and rejects invalid', () => {
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(isValidIban('FR1420041010050500013M02606')).toBe(true);
    expect(isValidIban('DE89370400440532013001')).toBe(false); // bad check digits
    expect(isValidIban('XX00')).toBe(false);
    expect(isValidIban(undefined)).toBe(false);
  });

  test('BIC accepts 8 and 11 char forms', () => {
    expect(isValidBic('DEUTDEFF')).toBe(true);
    expect(isValidBic('DEUTDEFF500')).toBe(true);
    expect(isValidBic('DEUT')).toBe(false);
    expect(isValidBic('1234DEFF')).toBe(false);
  });

  test('ABA routing checksum', () => {
    expect(isValidRoutingNumber('021000021')).toBe(true); // JPMorgan Chase (NY)
    expect(isValidRoutingNumber('011401533')).toBe(true);
    expect(isValidRoutingNumber('021000020')).toBe(false);
    expect(isValidRoutingNumber('12345')).toBe(false);
  });
});

describe('RailResolver', () => {
  const r = new RailResolver();

  test('derives SEPA for EUR + IBAN + SEPA country', () => {
    const dest: RailDestination = { countryCode: 'DE', currency: 'EUR', iban: 'DE89370400440532013000' };
    expect(r.resolve(dest)).toBe('sepa');
    expect(r.validate('sepa', dest).ok).toBe(true);
  });

  test('derives ACH for USD + routing + account + US', () => {
    const dest: RailDestination = { countryCode: 'US', currency: 'USD', routingNumber: '021000021', accountNumber: '123456789' };
    expect(r.resolve(dest)).toBe('ach');
    expect(r.validate('ach', dest).ok).toBe(true);
  });

  test('derives SWIFT for cross-border BIC', () => {
    const dest: RailDestination = { countryCode: 'SG', currency: 'SGD', bic: 'DBSSSGSG', accountNumber: '000123' };
    expect(r.resolve(dest)).toBe('swift');
    expect(r.validate('swift', dest).ok).toBe(true);
  });

  test('user override is respected', () => {
    const dest: RailDestination = { countryCode: 'DE', currency: 'EUR', iban: 'DE89370400440532013000', bic: 'DEUTDEFF' };
    expect(r.resolve(dest, 'swift')).toBe('swift');
  });

  test('unsupported corridor throws', () => {
    const dest: RailDestination = { countryCode: 'US', currency: 'USD' };
    expect(() => r.resolve(dest)).toThrow(UnsupportedCorridorError);
  });

  test('validation surfaces errors for a bad SEPA destination', () => {
    const dest: RailDestination = { countryCode: 'US', currency: 'USD', iban: 'DE89370400440532013001' };
    const v = r.validate('sepa', dest);
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });
});

import { nextRunDate } from '../../../../backend/src/modules/gateway/models/recurringMandate.model';

describe('recurring mandate nextRunDate', () => {
  test('advances by frequency period', () => {
    const base = new Date('2026-01-15T00:00:00.000Z');
    expect(nextRunDate(base, 'weekly').toISOString()).toBe('2026-01-22T00:00:00.000Z');
    expect(nextRunDate(base, 'monthly').toISOString()).toBe('2026-02-15T00:00:00.000Z');
    expect(nextRunDate(base, 'quarterly').toISOString()).toBe('2026-04-15T00:00:00.000Z');
    expect(nextRunDate(base, 'yearly').toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });
});

describe('FeeCalculator', () => {
  const f = new FeeCalculator(DEFAULT_FEE_SCHEDULE);

  test('SEPA is free, ACH low, SWIFT priced with correspondent surcharge', () => {
    expect(f.calculate('sepa', { countryCode: 'DE', currency: 'EUR', iban: 'DE89370400440532013000' })).toBe(0);
    expect(f.calculate('ach', { countryCode: 'US', currency: 'USD', routingNumber: '021000021', accountNumber: '1' })).toBe(0.25);
    expect(f.calculate('swift', { countryCode: 'SG', currency: 'SGD', bic: 'DBSSSGSG' })).toBe(15);
    expect(f.calculate('swift', { countryCode: 'SG', currency: 'SGD', bic: 'DBSSSGSG', correspondentBic: 'CHASUS33' })).toBe(25);
  });
});

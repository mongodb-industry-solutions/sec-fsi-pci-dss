// v37 P7: the issuer's card validation, now that the engine lives at the bank.
//
// Two things are being defended here. First, that the rules are CONFIGURATION: the accepted CVV, the CVV
// mode, the Luhn requirement and the supported networks all come from the stored record, so an operator can
// change them over the admin API without a code change. Second, that moving the engine did not change the
// per-card derivation, because every seeded card's CVV depends on it: a different algorithm would silently
// invalidate all of them, and nothing else in the suite would notice.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  validateCard, luhnValid, detectNetwork, isExpired,
  DEFAULT_CARD_ISSUER_CONFIG, type CardIssuerConfig,
} from '../../../bankcore/src/modules/card-issuer/services/cardValidation.service';
import {
  derivePerCardCvv as bankDerive, normalizeExpiry as bankNormalize,
} from '../../../bankcore/src/vendors/encryption/cardVerificationKey.service';
import {
  derivePerCardCvv as pspDerive, normalizeExpiry as pspNormalize,
} from '../../../backend/src/providers/card-issuer/services/cardVerificationKey.service';

// A Luhn-valid VISA test number, and a Mastercard in the 2-series range.
const VISA = '4111111111111111';
const MASTERCARD = '5555555555554444';
const AMEX = '378282246310005';

function config(overrides: Partial<CardIssuerConfig> = {}): CardIssuerConfig {
  return { ...DEFAULT_CARD_ISSUER_CONFIG, ...overrides };
}

describe('the issuer rules', () => {
  it('accepts a well-formed card and answers the approval code', () => {
    const result = validateCard({ cardNumber: VISA, expiry: '12/34' }, config());
    expect(result.valid).toBe(true);
    expect(result.responseCode).toBe('00');
    expect(result.network).toBe('VISA');
  });

  it('detects the network from the prefix, including a range', () => {
    const networks = DEFAULT_CARD_ISSUER_CONFIG.networks;
    expect(detectNetwork(VISA, networks)?.name).toBe('VISA');
    expect(detectNetwork(MASTERCARD, networks)?.name).toBe('MASTERCARD');
    // The 2-series range, which only a range rule matches.
    expect(detectNetwork('2221000000000009', networks)?.name).toBe('MASTERCARD');
    expect(detectNetwork(AMEX, networks)?.name).toBe('AMEX');
  });

  it('refuses a number that fails the check digit', () => {
    expect(luhnValid(VISA)).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    const result = validateCard({ cardNumber: '4111111111111112' }, config());
    expect(result.valid).toBe(false);
    expect(result.responseCode).toBe('14');
    expect(result.reasons).toContain('failed_luhn');
  });

  it('refuses an expired card with the expiry code, and treats the expiry month as inclusive', () => {
    // A card is valid THROUGH the end of its expiry month, which is the rule cardholders are used to.
    expect(isExpired('06/26', new Date('2026-06-30T23:00:00Z'))).toBe(false);
    expect(isExpired('06/26', new Date('2026-07-01T00:00:01Z'))).toBe(true);
    const result = validateCard({ cardNumber: VISA, expiry: '01/20' }, config());
    expect(result.responseCode).toBe('54');
  });

  it('does not treat an unparseable expiry as expired', () => {
    // An expired card and a malformed request are different answers, and conflating them would tell a
    // caller their perfectly good card had expired.
    expect(isExpired('not-a-date')).toBe(false);
  });

  it('refuses a card whose length is wrong for its network', () => {
    const result = validateCard({ cardNumber: '4111111111111', network: 'VISA' }, config({ enforceLuhn: false }));
    // 13 is a valid VISA length; 14 is not.
    expect(result.valid).toBe(true);
    expect(validateCard({ cardNumber: '41111111111116', network: 'VISA' }, config({ enforceLuhn: false })).reasons)
      .toContain('invalid_length');
  });

  it('refuses a network the configuration has disabled', () => {
    const withoutAmex = config({
      networks: DEFAULT_CARD_ISSUER_CONFIG.networks.map((n) => (n.name === 'AMEX' ? { ...n, enabled: false } : n)),
    });
    const result = validateCard({ cardNumber: AMEX }, withoutAmex);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('unsupported_network');
  });
});

describe('the CVV is a configured value, not a constant in code', () => {
  it('accepts the configured global value', () => {
    const result = validateCard({ cardNumber: VISA, cvv: '123' }, config());
    expect(result.cvvValidationResult).toBe('match');
    expect(result.valid).toBe(true);
  });

  it('accepts a DIFFERENT global value once it is configured, and then refuses the old one', () => {
    // This is the requirement in one assertion: the bypass code is editable at runtime. If it were
    // hardcoded, the first of these would fail and the second would pass.
    const changed = config({ validCvv: '987' });
    expect(validateCard({ cardNumber: VISA, cvv: '987' }, changed).cvvValidationResult).toBe('match');
    const stale = validateCard({ cardNumber: VISA, cvv: '123' }, changed);
    expect(stale.cvvValidationResult).toBe('mismatch');
    expect(stale.responseCode).toBe('82');
  });

  it('refuses the global value when the mode is per-card only', () => {
    const perCard = config({ cvvMode: 'per_card' });
    expect(validateCard({ cardNumber: VISA, cvv: '123' }, perCard).cvvValidationResult).toBe('mismatch');
    // The card's own derived value still passes.
    expect(validateCard({ cardNumber: VISA, cvv: '456', derivedCvv: '456' }, perCard).cvvValidationResult).toBe('match');
  });

  it('refuses the per-card value when the mode is global only', () => {
    const globalOnly = config({ cvvMode: 'global' });
    expect(validateCard({ cardNumber: VISA, cvv: '456', derivedCvv: '456' }, globalOnly).cvvValidationResult)
      .toBe('mismatch');
  });

  it('never accepts an absent derived value as a match', () => {
    // A card with no derivable value must not become a card that accepts anything.
    const perCard = config({ cvvMode: 'per_card' });
    expect(validateCard({ cardNumber: VISA, cvv: '000', derivedCvv: undefined }, perCard).cvvValidationResult)
      .toBe('mismatch');
    // And an empty configured global value must not turn an empty-ish CVV into a match either.
    const emptyGlobal = config({ cvvMode: 'global', validCvv: '' });
    expect(validateCard({ cardNumber: VISA, cvv: '0', derivedCvv: undefined }, emptyGlobal).cvvValidationResult)
      .toBe('mismatch');
  });

  it('reports no CVV rather than a mismatch when none was sent', () => {
    const result = validateCard({ cardNumber: VISA }, config());
    expect(result.cvvValidationResult).toBe('not_provided');
    expect(result.valid).toBe(true);
  });

  it('a CVV failure outranks the other refusals in the response code', () => {
    // ISO 8583 has one code per answer, and a wrong CVV is the one worth telling the acquirer about.
    const result = validateCard({ cardNumber: VISA, cvv: '000', expiry: '01/20' }, config());
    expect(result.responseCode).toBe('82');
  });
});

describe('P7 did not change the per-card derivation', () => {
  const cvk = createHash('sha256').update('a fixed key for this test').digest();
  const args = { cardToken: 'pm_b577f67eb747396e469372cf0144', expiryMMYY: '12/29', serviceCode: '201', cvvLength: 3 };

  it('the bank derives byte for byte what the PSP derived', () => {
    // The engine moved; the algorithm did not. Every seeded card's CVV depends on this, so a change here
    // would invalidate all of them at once with nothing else failing.
    expect(bankDerive(cvk, args)).toBe(pspDerive(cvk, args));
  });

  it('normalises an expiry the same way, so MM/YY and MM/YYYY still agree', () => {
    for (const expiry of ['12/29', '12/2029', '1/29', ' 12 / 29 ', 'garbage']) {
      expect(bankNormalize(expiry)).toBe(pspNormalize(expiry));
    }
    expect(bankNormalize('12/2029')).toBe(bankNormalize('12/29'));
  });

  it('produces a value of the requested length, and only digits', () => {
    for (const cvvLength of [3, 4]) {
      const value = bankDerive(cvk, { ...args, cvvLength });
      expect(value).toHaveLength(cvvLength);
      expect(value).toMatch(/^\d+$/);
    }
  });

  it('differs per card, which is the point of deriving it at all', () => {
    const other = bankDerive(cvk, { ...args, cardToken: 'pm_another_card_entirely' });
    expect(other).not.toBe(bankDerive(cvk, args));
  });
});

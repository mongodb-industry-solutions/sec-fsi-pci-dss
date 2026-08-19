// v37 P7.1: the card lifecycle and the limits an authorisation is judged against.
//
// The transitions are the interesting part. A status machine that accepts anything is not a status machine,
// and the two that matter here are that a revoked card is terminal (one token must never mean two different
// cards over time) and that a replacement issues BEFORE it revokes (a failure in between must leave the
// holder with a working card rather than none).
import { describe, it, expect } from 'vitest';
import {
  judgeCardForAuthorisation, type IssuedCardView,
} from '../../../bankcore/src/modules/card-issuer/services/cardLifecycle.service';

function card(overrides: Partial<IssuedCardView> = {}): IssuedCardView {
  return {
    cardToken: 'pm_test',
    network: 'VISA',
    bin: '453210',
    lastFour: '4321',
    maskedDisplay: '****-****-****-4321',
    status: 'active',
    expiryMonth: '12',
    expiryYear: '30',
    ...overrides,
  };
}

describe('what the issuer checks about the card before it looks at the money', () => {
  it('approves an active card in date with no limit set', () => {
    expect(judgeCardForAuthorisation(card(), 100, 'EUR')).toBeNull();
  });

  it('judges a card it never issued on the account alone', () => {
    // A mixed estate has to keep working: an unknown token is not the issuer's card, so it has nothing to
    // say about it, and refusing here would decline every card the bank did not mint.
    expect(judgeCardForAuthorisation(null, 100, 'EUR')).toBeNull();
  });

  it('refuses a card that is not active with the restricted-card code', () => {
    for (const status of ['issued', 'suspended', 'revoked'] as const) {
      const refusal = judgeCardForAuthorisation(card({ status }), 10, 'EUR');
      expect(refusal?.code, `${status} must be refused`).toBe('62');
      expect(refusal?.reason).toBe('card_not_active');
    }
  });

  it('refuses an expired card, counting the expiry month as still valid', () => {
    const inMonth = new Date('2030-12-31T23:00:00Z');
    const afterMonth = new Date('2031-01-01T00:00:01Z');
    expect(judgeCardForAuthorisation(card(), 10, 'EUR', inMonth)).toBeNull();
    expect(judgeCardForAuthorisation(card(), 10, 'EUR', afterMonth)?.code).toBe('54');
  });

  it('accepts a four-digit expiry year the same way as a two-digit one', () => {
    const afterMonth = new Date('2031-01-01T00:00:01Z');
    expect(judgeCardForAuthorisation(card({ expiryYear: '2030' }), 10, 'EUR', afterMonth)?.code).toBe('54');
  });

  it('declines above the per-transaction ceiling, and allows exactly at it', () => {
    const limited = card({ limits: { perTransactionAmount: 50 } });
    expect(judgeCardForAuthorisation(limited, 50, 'EUR')).toBeNull();
    const refusal = judgeCardForAuthorisation(limited, 50.01, 'EUR');
    expect(refusal?.code).toBe('61');
    expect(refusal?.reason).toBe('exceeds_transaction_limit');
  });

  it('refuses a limit stated in another currency rather than comparing across them', () => {
    // Comparing 50 EUR against a 50 GBP ceiling would be a number that happens to fit, which is worse than
    // refusing: the limit would appear enforced while meaning nothing.
    const limited = card({ limits: { perTransactionAmount: 50, limitCurrency: 'GBP' } });
    expect(judgeCardForAuthorisation(limited, 10, 'EUR')?.code).toBe('12');
    expect(judgeCardForAuthorisation(limited, 10, 'GBP')).toBeNull();
  });

  it('treats a card with no limit as unlimited, not as limited to zero', () => {
    expect(judgeCardForAuthorisation(card({ limits: {} }), 1_000_000, 'EUR')).toBeNull();
  });

  it('checks the status before the limit, so a blocked card does not report a limit problem', () => {
    const blocked = card({ status: 'suspended', limits: { perTransactionAmount: 1 } });
    expect(judgeCardForAuthorisation(blocked, 999, 'EUR')?.reason).toBe('card_not_active');
  });
});

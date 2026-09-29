/**
 * Unit tests: internal Verification of Payee engine (v28, FR-v28-04b).
 * Source: backend/src/providers/vop/services/vop.service.ts
 * VoP is ADDITIONAL to FDS/AML/HRP: name-vs-account match, market-gated, data-driven decision policy.
 */
import { describe, it, expect } from 'vitest';
import { verifyPayee } from '../../../../../psp/backend/src/providers/vop/services/vop.service';

describe('VoP engine', () => {
  it('returns match for an exact name', () => {
    const r = verifyPayee({ declaredName: 'Jane Doe', accountHolderName: 'Jane Doe', countryCode: 'ES' });
    expect(r.matchResult).toBe('match');
    expect(r.matchScore).toBeGreaterThanOrEqual(95);
    expect(r.decision).toBe('pass');
  });

  it('is case/diacritics and token-order insensitive', () => {
    const r = verifyPayee({ declaredName: 'jane  DOE', accountHolderName: 'Doe Jané', countryCode: 'FR' });
    expect(['match', 'close_match']).toContain(r.matchResult);
  });

  it('flags a no_match for a different name', () => {
    const r = verifyPayee({ declaredName: 'Jane Doe', accountHolderName: 'Vladimir Sanction', countryCode: 'DE' });
    expect(r.matchResult).toBe('no_match');
  });

  it('is not_supported (advisory) outside enabled markets', () => {
    const r = verifyPayee({ declaredName: 'Jane Doe', accountHolderName: 'Jane Doe', countryCode: 'US' });
    expect(r.matchResult).toBe('not_supported');
    expect(r.decision).toBe('pass');
  });

  it('blocks a non-match only when VoP is mandatory above an amount', () => {
    const cfg = { policy: { noMatch: 'warn' as const, mandatoryAboveAmount: 100 } };
    const warn = verifyPayee({ declaredName: 'A B', accountHolderName: 'X Y', countryCode: 'ES', amount: 50 }, cfg);
    expect(warn.decision).toBe('warn');
    const block = verifyPayee({ declaredName: 'A B', accountHolderName: 'X Y', countryCode: 'ES', amount: 500 }, cfg);
    expect(block.decision).toBe('block');
  });
});

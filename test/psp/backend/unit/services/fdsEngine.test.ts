/**
 * Unit tests: FDS data-driven rule engine (P13.2).
 * Covers the amount-field fix (gate dispatches `amount`, not `transactionAmount`), real rulesFired,
 * config-driven rules, MCC/velocity signals, and the review/decline bands.
 */
import { describe, it, expect } from 'vitest';
import { scoreFds, resolveFdsRules, FdsModuleConfig } from '../../../../../psp/backend/src/providers/fds/services/fds.service';

describe('FDS rule engine (P13.2)', () => {
  it('reads the dispatched `amount` field (not `transactionAmount`)', () => {
    // Regression for the field-name bug: the gate sends `amount`. A high `amount` must flag.
    const r = scoreFds({ amount: 8508, currency: 'USD' });
    expect(r.riskScore).toBeGreaterThan(15);
    expect(r.fraudFlag).toBe(true);
    expect(r.recommendation).toBe('review');
  });

  it('still tolerates the legacy `transactionAmount` field', () => {
    expect(scoreFds({ transactionAmount: 8508 }).fraudFlag).toBe(true);
  });

  it('approves a low-value transaction with a floor risk score and no rules fired', () => {
    const r = scoreFds({ amount: 100 });
    expect(r.recommendation).toBe('approve');
    expect(r.fraudFlag).toBe(false);
    expect(r.rulesFired).toEqual([]);
    expect(r.riskScore).toBe(10);
  });

  it('returns the REAL ids of the rules that fired (no hardcoded list)', () => {
    const r = scoreFds({ amount: 600 });
    expect(r.rulesFired).toContain('HIGH_VALUE_TXN');
    expect(r.rulesFired).toContain('ELEVATED_VALUE_TXN');
    expect(r.rulesFired).not.toContain('RISKY_MCC');
  });

  it('fires the risky-MCC rule when configured and the MCC matches', () => {
    const cfg: FdsModuleConfig = { amount: { reviewAmount: 500 }, riskyMcc: ['7995'] };
    const r = scoreFds({ amount: 100, merchantCategoryCode: '7995' }, cfg);
    expect(r.rulesFired).toContain('RISKY_MCC');
    expect(r.recommendation).toBe('review');
  });

  it('honours an explicit rules[] config over the shorthands', () => {
    const cfg: FdsModuleConfig = {
      rules: [{ id: 'CUSTOM_BIG', label: 'over 1000', when: { field: 'amount', op: 'gt', value: 1000 }, score: 80, action: 'review' }],
      bands: { reviewAtOrAbove: 50 },
    };
    expect(scoreFds({ amount: 500 }, cfg).recommendation).toBe('approve');
    const big = scoreFds({ amount: 2000 }, cfg);
    expect(big.rulesFired).toEqual(['CUSTOM_BIG']);
    expect(big.recommendation).toBe('review');
  });

  it('declines when a fired rule forces decline or the decline band is reached', () => {
    const cfg: FdsModuleConfig = {
      amount: { reviewAmount: 500, declineAmount: 5000 },
      bands: { reviewAtOrAbove: 50, declineAtOrAbove: 120 },
    };
    expect(scoreFds({ amount: 6000 }, cfg).recommendation).toBe('decline'); // VERY_HIGH_VALUE_TXN action=decline
  });

  it('resolveFdsRules synthesises the documented default rule set', () => {
    const rules = resolveFdsRules();
    expect(rules.map((r) => r.id)).toContain('HIGH_VALUE_TXN');
    expect(rules.map((r) => r.id)).toContain('ELEVATED_VALUE_TXN');
  });

  it('resolveFdsRules returns the explicit rules verbatim when provided (filtering disabled ones)', () => {
    const rules = resolveFdsRules({
      rules: [
        { id: 'A', label: 'a', when: { field: 'amount', op: 'gt', value: 1 }, score: 10 },
        { id: 'B', label: 'b', when: { field: 'amount', op: 'gt', value: 2 }, score: 10, enabled: false },
      ],
    });
    expect(rules.map((r) => r.id)).toEqual(['A']);
  });
});

/**
 * Unit tests: frontend/src/lib/constants.ts
 * Validates all five demo users, role labels, color maps, and formatRiskIndicator.
 */
import { describe, it, expect } from 'vitest';
import {
  DEMO_PASSWORD,
  ROLE_LABELS,
  SEVERITY_COLORS,
  STATUS_COLORS,
  formatRiskIndicator,
} from '../../../../frontend/src/lib/constants';

// All seeded demo accounts now share one bcrypt-hashed credential exposed via the
// single DEMO_PASSWORD constant (the per-user DEMO_USERS_PASSWORDS map was removed).
describe('DEMO_PASSWORD', () => {
  it('is the fixed demo-password convention', () => {
    expect(DEMO_PASSWORD).toBe('demo-password');
  });

  it('is a non-empty string', () => {
    expect(typeof DEMO_PASSWORD).toBe('string');
    expect(DEMO_PASSWORD.length).toBeGreaterThan(0);
  });
});

describe('ROLE_LABELS', () => {
  it('defines labels for all four demo roles', () => {
    expect(ROLE_LABELS.customer).toBeTruthy();
    expect(ROLE_LABELS.level1_analyst).toBeTruthy();
    expect(ROLE_LABELS.level2_investigator).toBeTruthy();
    expect(ROLE_LABELS.security_auditor).toBeTruthy();
  });
});

describe('SEVERITY_COLORS', () => {
  it('defines Tailwind classes for all four severity levels', () => {
    expect(SEVERITY_COLORS.critical).toContain('red');
    expect(SEVERITY_COLORS.high).toContain('red');
    expect(SEVERITY_COLORS.medium).toContain('yellow');
    expect(SEVERITY_COLORS.low).toContain('green');
  });
});

describe('STATUS_COLORS', () => {
  it('defines Tailwind classes for all case statuses', () => {
    const statuses = ['open', 'under_review', 'escalated', 'resolved_cleared', 'resolved_fraud', 'closed'];
    for (const s of statuses) {
      expect(STATUS_COLORS[s]).toBeTruthy();
    }
  });
});

describe('formatRiskIndicator', () => {
  it('formats amount_threshold with human-readable label', () => {
    expect(formatRiskIndicator('amount_threshold')).toBe(
      'High-value transaction (amount exceeds fraud threshold)'
    );
  });

  it('formats known MCC code with category label', () => {
    const result = formatRiskIndicator('high_risk_mcc_7995');
    expect(result).toContain('7995');
    expect(result).toContain('Gambling');
  });

  it('formats unknown MCC code without label', () => {
    const result = formatRiskIndicator('high_risk_mcc_9999');
    expect(result).toContain('9999');
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('null');
  });

  it('falls back to replacing underscores for unknown indicators', () => {
    expect(formatRiskIndicator('velocity_check_failed')).toBe('velocity check failed');
  });

  it('handles empty string without throwing', () => {
    expect(() => formatRiskIndicator('')).not.toThrow();
  });
});

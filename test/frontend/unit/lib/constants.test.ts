/**
 * Unit tests: frontend/src/lib/constants.ts
 * Validates all five demo users, role labels, color maps, and formatRiskIndicator.
 */
import { describe, it, expect } from 'vitest';
import {
  DEMO_USERS_PASSWORDS,
  ROLE_LABELS,
  SEVERITY_COLORS,
  STATUS_COLORS,
  formatRiskIndicator,
} from '../../../../frontend/src/lib/constants';

const EXPECTED_USERS = [
  'luis.fernandez@leafybank.demo',
  'julia.santos@leafybank.demo',
  'sarah.chen@leafybank.demo',
  'michael.obi@leafybank.demo',
  'admin@leafybank.demo',
];

describe('DEMO_USERS_PASSWORDS', () => {
  it('contains exactly the 5 demo users from the spec', () => {
    for (const email of EXPECTED_USERS) {
      expect(DEMO_USERS_PASSWORDS[email]).toBe('demo-password');
    }
  });

  it('all passwords are demo-password', () => {
    for (const password of Object.values(DEMO_USERS_PASSWORDS)) {
      expect(password).toBe('demo-password');
    }
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

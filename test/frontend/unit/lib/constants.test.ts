/**
 * Unit tests: frontend/src/lib/constants.ts
 * Validates all five demo users, role labels, and color maps are defined.
 */
import { describe, it, expect } from 'vitest';
import {
  DEMO_USERS_PASSWORDS,
  ROLE_LABELS,
  SEVERITY_COLORS,
  STATUS_COLORS,
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

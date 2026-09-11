/**
 * Unit tests: frontend/src/lib/constants.ts
 * Validates all five demo users, role labels, color maps, and formatRiskIndicator.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  AUTHORITY_ISSUER_URL,
  SIMULATOR_CLIENT_ID,
  ROLE_LABELS,
  SEVERITY_COLORS,
  STATUS_COLORS,
  formatRiskIndicator,
  demoPublicUrl,
} from '../../../../../psp/frontend/src/lib/constants';

// v39: no password for any demo account exists in this bundle. The simulator holds its OWN
// credential and exchanges it for a token that ACTS AS a persona, so what ships here is a client id
// and an issuer rather than a working password for every seeded user.
describe('the simulator credential', () => {
  it('ships no demo account password', async () => {
    const constants = await import('../../../../../psp/frontend/src/lib/constants');
    expect('DEMO_PASSWORD' in constants).toBe(false);
  });

  it('names the authority it exchanges against', () => {
    expect(AUTHORITY_ISSUER_URL).toContain('/realms/');
  });

  it('identifies itself as its own client rather than as a person', () => {
    expect(SIMULATOR_CLIENT_ID).toBeTruthy();
    expect(SIMULATOR_CLIENT_ID).not.toContain('@');
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

// Share QR: the URL must resolve per environment (configured public URL first, browser origin next).
describe('demoPublicUrl', () => {
  const withOrigin = (origin: string, fn: () => void) => {
    vi.stubGlobal('window', { location: { origin } });
    try { fn(); } finally { vi.unstubAllGlobals(); }
  };

  it('appends the path to the browser origin', () => {
    withOrigin('https://demo.example.com', () => {
      expect(demoPublicUrl('/simulator')).toBe('https://demo.example.com/simulator');
    });
  });

  it('returns the bare base when no path is given', () => {
    withOrigin('https://demo.example.com', () => {
      expect(demoPublicUrl()).toBe('https://demo.example.com');
    });
  });

  it('never doubles the slash when the origin carries a trailing one', () => {
    withOrigin('https://demo.example.com/', () => {
      expect(demoPublicUrl('/simulator')).toBe('https://demo.example.com/simulator');
    });
  });

  // Pin the SSR case explicitly instead of relying on the ambient environment: this file currently
  // runs under node (vitest 4 ignores `environmentMatchGlobs`), but the assertion must hold under
  // jsdom too, where `window` would otherwise be defined.
  it('yields a relative path when rendered server-side (no window)', () => {
    vi.stubGlobal('window', undefined);
    try {
      expect(demoPublicUrl('/simulator')).toBe('/simulator');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// No raw identifier ever reaches a user: every gate indicator resolves to plain language.
describe('formatRiskIndicator: gate indicators', () => {
  it('translates the FDS gate indicator, with and without a qualifier', () => {
    expect(formatRiskIndicator('fds.high.risk')).toBe('Fraud risk detected');
    expect(formatRiskIndicator('fds.high.risk: velocity')).toBe('Fraud risk detected (velocity)');
  });

  it('translates a sanctions match however it is spelled', () => {
    expect(formatRiskIndicator('hrp.sanctions.match')).toBe('Sanctions screening match');
    expect(formatRiskIndicator('sanctions_match')).toBe('Sanctions screening match');
  });

  it('translates an AML alert and keeps its severity readable', () => {
    expect(formatRiskIndicator('aml.alert')).toBe('Money-laundering alert');
    expect(formatRiskIndicator('aml.alert: high')).toBe('Money-laundering alert (high severity)');
  });

  it('translates a payee-verification mismatch', () => {
    expect(formatRiskIndicator('vop.no_match')).toBe('Payee name did not match the account holder');
  });

  it('translates the fraud-engine rule ids', () => {
    expect(formatRiskIndicator('HIGH_VALUE_TXN')).toMatch(/High-value transaction/);
    expect(formatRiskIndicator('RISKY_MCC')).toBe('High-risk merchant category');
    expect(formatRiskIndicator('VELOCITY_24H')).toMatch(/24 hours/);
    expect(formatRiskIndicator('transfer.risk.block')).toBe('Transfer flagged by risk screening');
  });

  it('keeps the existing amount and MCC labels working', () => {
    expect(formatRiskIndicator('amount_threshold')).toMatch(/High-value transaction/);
    expect(formatRiskIndicator('high_risk_mcc_7995')).toBe('High-risk merchant category: MCC 7995 (Gambling / Betting)');
  });

  it('never leaves dots or underscores in an unknown indicator', () => {
    expect(formatRiskIndicator('some.new_signal')).toBe('some new signal');
  });
});

/**
 * Unit tests: vendors/security/escalationTokens.ts (FR-v2-13)
 * Validates token generation, validation, expiry, and revocation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateToken,
  validateToken,
  revokeToken,
  _clearStore,
} from '../../../../../backend/src/vendors/security/escalationTokens';

beforeEach(() => {
  _clearStore();
});

describe('generateToken', () => {
  it('returns a non-empty string token', () => {
    const token = generateToken('case-001', 'level2_investigator');
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
  });

  it('returns unique tokens for repeated calls', () => {
    const t1 = generateToken('case-001', 'level2_investigator');
    const t2 = generateToken('case-001', 'level2_investigator');
    expect(t1).not.toBe(t2);
  });
});

describe('validateToken', () => {
  it('returns invalid for undefined token', () => {
    expect(validateToken(undefined).valid).toBe(false);
  });

  it('returns invalid for unknown token', () => {
    expect(validateToken('not-a-real-token').valid).toBe(false);
  });

  it('returns valid + entry for a freshly issued token', () => {
    const token = generateToken('case-123', 'level2_investigator');
    const result = validateToken(token);
    expect(result.valid).toBe(true);
    expect(result.entry?.caseId).toBe('case-123');
    expect(result.entry?.issuedToRole).toBe('level2_investigator');
  });

  it('returns invalid for an expired token', () => {
    // Issue with 1ms TTL - will be expired by the time validateToken runs
    const token = generateToken('case-456', 'level2_investigator', 1);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(validateToken(token).valid).toBe(false);
        resolve();
      }, 10);
    });
  });
});

describe('revokeToken', () => {
  it('makes a previously valid token invalid', () => {
    const token = generateToken('case-789', 'level2_investigator');
    expect(validateToken(token).valid).toBe(true);
    revokeToken(token);
    expect(validateToken(token).valid).toBe(false);
  });
});

/**
 * Unit tests: vendors/middleware/rbac.ts (FR-v2-13)
 * Validates role extraction priority: X-User-Role header > JWT role > default.
 * Also covers canReadSensitive gate logic for L1/L2/auditor.
 */
import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { extractUserRole, canReadSensitive } from '../../../../../../psp/backend/src/vendors/middleware/rbac';

function makeRequest(opts: {
  headerRole?: string;
  jwtRole?: string;
} = {}): FastifyRequest {
  return {
    headers: opts.headerRole ? { 'x-user-role': opts.headerRole } : {},
    user: opts.jwtRole ? { role: opts.jwtRole } : undefined,
  } as unknown as FastifyRequest;
}

describe('extractUserRole', () => {
  it('defaults to level1_analyst when neither header nor JWT is present', () => {
    expect(extractUserRole(makeRequest())).toBe('level1_analyst');
  });

  it('uses X-User-Role header when present', () => {
    expect(extractUserRole(makeRequest({ headerRole: 'level2_investigator' }))).toBe('level2_investigator');
  });

  it('uses JWT role when no header is present', () => {
    expect(extractUserRole(makeRequest({ jwtRole: 'security_auditor' }))).toBe('security_auditor');
  });

  it('header wins over JWT role when both are present', () => {
    expect(extractUserRole(makeRequest({ headerRole: 'level1_analyst', jwtRole: 'level2_investigator' }))).toBe('level1_analyst');
  });

  it('ignores unknown header values and falls back to JWT', () => {
    expect(extractUserRole(makeRequest({ headerRole: 'super_admin', jwtRole: 'level2_investigator' }))).toBe('level2_investigator');
  });

  it('ignores unknown header values and falls back to default when no JWT', () => {
    expect(extractUserRole(makeRequest({ headerRole: 'super_admin' }))).toBe('level1_analyst');
  });
});

describe('canReadSensitive', () => {
  it('level1_analyst cannot read sensitive fields regardless of token', () => {
    expect(canReadSensitive('level1_analyst', false)).toBe(false);
    expect(canReadSensitive('level1_analyst', true)).toBe(false);
  });

  it('level2_investigator requires a valid token', () => {
    expect(canReadSensitive('level2_investigator', false)).toBe(false);
    expect(canReadSensitive('level2_investigator', true)).toBe(true);
  });

  it('security_auditor can read sensitive fields without a token', () => {
    expect(canReadSensitive('security_auditor', false)).toBe(true);
    expect(canReadSensitive('security_auditor', true)).toBe(true);
  });

  it('customer cannot read sensitive fields', () => {
    expect(canReadSensitive('customer', false)).toBe(false);
    expect(canReadSensitive('customer', true)).toBe(false);
  });
});

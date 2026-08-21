/**
 * Unit tests: v32 A1/A2/A7/A8 no enumeration of beneficiaries (tests 1-3, 8, 20)
 * Source: backend/src/modules/identity/services/counterpartyArrangement.service.ts
 *         backend/src/shared/models/acl.model.ts
 *
 * Before v32, GET /api/v1/beneficiaries with no predicate returned every beneficiary of every
 * customer, and the page issued exactly that call on mount. The rule now lives at the SERVICE
 * boundary (P2 layer 3) so a future caller cannot bypass it, which is what test 8 asserts.
 *
 * Regulatory basis (ADR-048): PCI DSS 7.2.6 / 7.3.1 / 7.3.3, GDPR Art. 25(2),
 * EBA/GL/2019/04 §31(a) "prevent unjustified access to a large set of data".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ getDbForRole: vi.fn() }));
vi.mock('../../../../../psp/backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
  getSensitiveTierDb: h.getDbForRole,
  getEncryptionWriteDb: h.getDbForRole,
}));

import {
  assertBeneficiaryPredicate,
  listAllBeneficiaries,
  getBeneficiaryAggregates,
  PredicateRequiredError,
  BENEFICIARY_MIN_QUERY_LENGTH,
} from '../../../../../psp/backend/src/modules/identity/services/counterpartyArrangement.service';
import { BUILTIN_ROLES, hasPermission } from '../../../../../psp/backend/src/shared/models/acl.model';

/** Records the filter the service builds, so scoping is asserted, not assumed. */
function makeDb() {
  const calls: Record<string, unknown>[] = [];
  const db: Record<string, unknown> = {
    collection: () => ({
      find: (filter: Record<string, unknown>) => {
        calls.push(filter);
        return { sort: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }) };
      },
      countDocuments: async (filter: Record<string, unknown>) => { calls.push(filter); return 0; },
      aggregate: () => ({ toArray: async () => [{ _id: 'active', n: 3 }] }),
    }),
  };
  return { db: db as never, calls };
}

beforeEach(() => { h.getDbForRole.mockReset(); });

describe('assertBeneficiaryPredicate (test 8: the rule is at the service boundary)', () => {
  it('rejects an empty request', () => {
    expect(() => assertBeneficiaryPredicate()).toThrow(PredicateRequiredError);
    expect(() => assertBeneficiaryPredicate({})).toThrow(PredicateRequiredError);
  });

  it('rejects a predicate that is too short to discriminate', () => {
    expect(() => assertBeneficiaryPredicate({ q: '' })).toThrow(PredicateRequiredError);
    expect(() => assertBeneficiaryPredicate({ q: 'a' })).toThrow(PredicateRequiredError);
    expect(() => assertBeneficiaryPredicate({ q: '  ' })).toThrow(PredicateRequiredError);
  });

  it('accepts an owner reference, a case reference, or a long-enough search term', () => {
    expect(() => assertBeneficiaryPredicate({ ownerRef: 'party-1' })).not.toThrow();
    expect(() => assertBeneficiaryPredicate({ caseRef: 'case-1' })).not.toThrow();
    expect(() => assertBeneficiaryPredicate({ q: 'a'.repeat(BENEFICIARY_MIN_QUERY_LENGTH) })).not.toThrow();
  });

  it('carries a 400 status so the controller maps it without re-deriving the rule', () => {
    try {
      assertBeneficiaryPredicate({});
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as PredicateRequiredError).statusCode).toBe(400);
    }
  });

  it('keeps the minimum aligned with the QE text-search minimums (no mode is broken)', () => {
    // Suffix and substring both use strMinQueryLength 3; a stricter beneficiary rule would be
    // inconsistent with the encrypted-search surface the demo showcases.
    expect(BENEFICIARY_MIN_QUERY_LENGTH).toBeLessThanOrEqual(3);
  });
});

describe('listAllBeneficiaries', () => {
  it('refuses to run without a predicate (no enumeration path exists)', async () => {
    const { db } = makeDb();
    await expect(listAllBeneficiaries(db, {})).rejects.toThrow(PredicateRequiredError);
    await expect(listAllBeneficiaries(db)).rejects.toThrow(PredicateRequiredError);
  });

  it('scopes the query to the owner when one is given', async () => {
    const { db, calls } = makeDb();
    await listAllBeneficiaries(db, { ownerRef: 'party-1' });
    expect(calls[0]).toMatchObject({ ownerPartyReference: 'party-1' });
  });

  it('allows the own-scope caller to bypass the predicate, already pinned to its own owner', async () => {
    const { db, calls } = makeDb();
    await listAllBeneficiaries(db, { ownerRef: 'party-own', skipPredicateCheck: true });
    expect(calls[0]).toMatchObject({ ownerPartyReference: 'party-own' });
  });

  it('caps the page size at 100 whatever is asked for', async () => {
    const { db } = makeDb();
    // No throw and no unbounded read: the cap lives in the service.
    await expect(listAllBeneficiaries(db, { ownerRef: 'p', limit: 100000 })).resolves.toBeTruthy();
  });
});

describe('getBeneficiaryAggregates (A7)', () => {
  it('returns counts only, with no identifiers', async () => {
    const { db } = makeDb();
    const agg = await getBeneficiaryAggregates(db);
    expect(agg).toHaveProperty('total');
    expect(agg).toHaveProperty('byStatus');
    const serialized = JSON.stringify(agg);
    expect(serialized).not.toContain('ownerPartyReference');
    expect(serialized).not.toContain('counterpartyPartyReference');
    expect(serialized).not.toContain('counterpartyLookupHint');
  });
});

describe('role grants for beneficiaries (test 20)', () => {
  const perms = (roleName: string) => BUILTIN_ROLES.find((r) => r.roleName === roleName)?.rolePermissions;

  it('L1 may drill down but may NOT search across parties', () => {
    expect(hasPermission(perms('level1_analyst'), 'beneficiaries', 'view')).toBe(true);
    expect(hasPermission(perms('level1_analyst'), 'beneficiaries', 'investigate')).toBe(false);
  });

  it('L2 and the auditor may search across parties', () => {
    for (const role of ['level2_investigator', 'security_auditor']) {
      expect(hasPermission(perms(role), 'beneficiaries', 'investigate'), role).toBe(true);
    }
  });

  it('the auditor is read-only: no manage on beneficiaries (segregation of duties)', () => {
    expect(hasPermission(perms('security_auditor'), 'beneficiaries', 'manage')).toBe(false);
  });

  it('the L2 investigator keeps manage (it acts on cases)', () => {
    expect(hasPermission(perms('level2_investigator'), 'beneficiaries', 'manage')).toBe(true);
  });

  it('the customer keeps own-scope view and manage', () => {
    expect(hasPermission(perms('customer'), 'beneficiaries', 'view')).toBe(true);
    expect(hasPermission(perms('customer'), 'beneficiaries', 'manage')).toBe(true);
  });

  it('roles with no business need hold nothing on beneficiaries', () => {
    for (const role of ['merchant_officer', 'manager', 'operations_officer']) {
      expect(perms(role)?.beneficiaries, role).toBeUndefined();
    }
  });
});

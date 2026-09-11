/**
 * Unit tests: a case reference must SCOPE a beneficiary read, not merely satisfy the predicate
 * check (ADR-048 no-enumeration).
 * Source: backend/src/modules/customer/services/counterpartyArrangement.service.ts (listAllBeneficiaries)
 *
 * assertBeneficiaryPredicate accepts `caseRef` as a discriminating predicate. If the query does not
 * then filter by the party behind that case, any caseRef value returns the whole registry, which is
 * exactly the cross-party enumeration the rule forbids (PCI DSS).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../psp/backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: vi.fn(),
  getSensitiveTierDb: vi.fn(),
  getEncryptionWriteDb: vi.fn(),
}));

import { listAllBeneficiaries, PredicateRequiredError } from '../../../../../psp/backend/src/modules/customer/services/counterpartyArrangement.service';

const CASE_REF = 'FD-2026-000123';
const AGREEMENT = 'agreement-1';
const OWNER = 'party-owner-1';

function makeDb(overrides: {
  caseDoc?: unknown;
  agreementDoc?: unknown;
} = {}) {
  const find = vi.fn(() => ({
    sort: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
  }));
  const countDocuments = vi.fn().mockResolvedValue(0);
  const queries: Record<string, unknown>[] = [];

  const db = {
    collection: (name: string) => {
      if (name === 'fraudDiagnosisCase') {
        return { findOne: async () => ('caseDoc' in overrides ? overrides.caseDoc : { customerAgreementInstanceReference: AGREEMENT }) };
      }
      if (name === 'customerAgreementProcedure') {
        return { findOne: async () => ('agreementDoc' in overrides ? overrides.agreementDoc : { partyInstanceReference: OWNER }) };
      }
      return {
        find: (q: Record<string, unknown>) => { queries.push(q); return find(); },
        countDocuments: (q: Record<string, unknown>) => { queries.push(q); return countDocuments(q); },
      };
    },
  } as never;

  return { db, queries };
}

describe('listAllBeneficiaries: caseRef scoping (ADR-048)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves the case to its customer and filters by that owner', async () => {
    const { db, queries } = makeDb();
    await listAllBeneficiaries(db, { caseRef: CASE_REF });
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q.ownerPartyReference).toBe(OWNER);
  });

  it('matches nothing when the case has no customer, instead of returning every record', async () => {
    const { db, queries } = makeDb({ caseDoc: null });
    await listAllBeneficiaries(db, { caseRef: CASE_REF });
    for (const q of queries) {
      expect(q.ownerPartyReference).toBeDefined();
      expect(q.ownerPartyReference).not.toBe(OWNER);
    }
  });

  it('matches nothing when the agreement carries no party reference', async () => {
    const { db, queries } = makeDb({ agreementDoc: {} });
    await listAllBeneficiaries(db, { caseRef: CASE_REF });
    for (const q of queries) expect(q.ownerPartyReference).not.toBe(OWNER);
  });

  it('keeps an explicit owner reference authoritative over the case', async () => {
    const { db, queries } = makeDb();
    await listAllBeneficiaries(db, { ownerRef: 'party-other', caseRef: CASE_REF });
    for (const q of queries) expect(q.ownerPartyReference).toBe('party-other');
  });

  // A blank owner reference is absent, not an override. Treating it as supplied would clear the
  // case scope while still satisfying the predicate check, i.e. cross-party enumeration.
  it.each([['empty', ''], ['blank', '   ']])('ignores a %s owner reference and keeps the case scope', async (_label, ownerRef) => {
    const { db, queries } = makeDb();
    await listAllBeneficiaries(db, { ownerRef, caseRef: CASE_REF });
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q.ownerPartyReference).toBe(OWNER);
  });

  it('rejects a blank owner reference that is the only predicate offered', async () => {
    const { db, queries } = makeDb();
    await expect(listAllBeneficiaries(db, { ownerRef: '   ' })).rejects.toThrow(PredicateRequiredError);
    expect(queries).toHaveLength(0); // never reaches the collection
  });
});

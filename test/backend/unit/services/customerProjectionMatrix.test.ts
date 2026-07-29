/**
 * Unit tests: v32 B1/B2 customer projection conformance to the cross-role matrix (tests 9, 14, 21)
 * Source: backend/src/modules/customer/services/customerAgreement.service.ts (buildResponse)
 *         plan tmp/dev.v32.plan.md §4.1
 *
 * P3 (cross-role consistency): all worker roles see the SAME field set for a record; they differ
 * only in reach, tier and write. This test is the enforcement mechanism: the expected key set per
 * role is declared here from the plan's matrix, so a field added to the projection without a matrix
 * decision, or a role-specific divergence like the v32 government-ID defect, fails the build.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getDbForRole: vi.fn(),
  validateToken: vi.fn().mockReturnValue({ valid: false }),
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
  getSensitiveTierDb: h.getDbForRole,
  getEncryptionWriteDb: h.getDbForRole,
}));
vi.mock('../../../../backend/src/vendors/security/escalationTokens', () => ({
  validateToken: h.validateToken,
}));
vi.mock('../../../../backend/src/modules/fraud/services/fraudDiagnosis.service', () => ({
  appendAuditEvent: h.appendAuditEvent,
}));

import { getByInstanceReference } from '../../../../backend/src/modules/customer/services/customerAgreement.service';
import { PARTY_COLLECTION } from '../../../../backend/src/modules/identity/models/party.model';

const GOV_ID = { type: 'driver_license', number: 'GB31454621', issuingCountry: 'GB', expiryDate: '2031-12-24' };

const party = {
  partyInstanceReference: 'party-1',
  partyName: 'Luis Fernandez',
  partyEmailAddress: 'luis@example.com',
  partyMobilePhoneNumber: '+34-600-111-222',
};

const agreement = {
  customerAgreementInstanceReference: 'ca-1',
  partyInstanceReference: 'party-1',
  customerAgreementReference: 'ACC-LF-1',
  customerSegment: 'retail',
  customerAgreementStatus: 'active',
  customerAgreementEnrollmentDate: '2024-01-15',
  customerAgreementPreferredLanguage: 'es',
  customerAgreementKycCheck: { customerAgreementKycCheckStatus: 'verified' },
  customerAgreementGovernmentID: GOV_ID,
  customerAgreementTaxIDNumber: 'ES12345678',
  customerAgreementOccupation: 'engineer',
  // Decrypted QE:none values (as the L2 client would return them) plus the pre-v32 leftover.
  customerAgreementResidentialAddress: { streetAddress: '1 Calle', city: 'Madrid', postalCode: '28001', countryCode: 'ES' },
  customerAgreementRiskNotes: 'no prior fraud',
  governmentIdentificationReference: 'SYNTH-LF-4821',
  bianServiceDomain: 'Customer Agreement',
  bianControlRecordType: 'CustomerAgreementProcedure',
};

function makeDb() {
  return {
    collection: vi.fn((name: string) => ({
      findOne: vi.fn(async () => (name === PARTY_COLLECTION ? party : agreement)),
    })),
  };
}

/** §4.1: the lookup-tier field set every worker role receives for a reachable record. */
const SHARED_KEYS = [
  'customerAgreementInstanceReference',
  'partyInstanceReference',
  'customerName',
  'customerAgreementReference',
  'customerSegment',
  'customerAgreementStatus',
  'customerAgreementEnrollmentDate',
  'customerAgreementPreferredLanguage',
  'customerAgreementKycCheck',
  'customerAgreementGovernmentID',
  'customerAgreementTaxIDNumber',
  'customerAgreementOccupation',
  'contactPiiRestricted',
  'bianServiceDomain',
  'bianControlRecordType',
];

/** Sensitive-tier keys that must never appear as plaintext outside the audited escalation path. */
const SENSITIVE_KEYS = [
  'customerAgreementResidentialAddress',
  'customerAgreementRiskNotes',
  'customerAgreementSourceOfFunds',
  'customerAgreementPurposeOfRelationship',
  'governmentIdentificationReference',
];

beforeEach(() => {
  h.validateToken.mockReturnValue({ valid: false });
  h.getDbForRole.mockReset();
  h.getDbForRole.mockResolvedValue(makeDb());
});

describe('projection conformance to the §4.1 matrix', () => {
  for (const role of ['level1_analyst', 'level2_investigator', 'security_auditor', 'operations_officer'] as const) {
    it(`${role} receives exactly the shared lookup-tier field set`, async () => {
      const res = await getByInstanceReference({} as never, 'ca-1', role as never);
      const keys = Object.keys(res as Record<string, unknown>)
        .filter((k) => k !== 'sensitive' && k !== 'sensitiveAvailable'
          && k !== 'customerEmailAddress' && k !== 'customerMobilePhoneNumber');
      // Same set for every role: no field is role-specific (the v32 defect).
      expect(keys.sort()).toEqual([...SHARED_KEYS].sort());
    });
  }

  it('exposes the structured identity document, never the deprecated reference', async () => {
    for (const role of ['level1_analyst', 'security_auditor'] as const) {
      const res = await getByInstanceReference({} as never, 'ca-1', role as never) as Record<string, unknown>;
      expect(res.customerAgreementGovernmentID).toEqual(GOV_ID);
      expect(JSON.stringify(res)).not.toContain('SYNTH-');
      expect(JSON.stringify(res)).not.toContain('governmentIdentificationReference');
    }
  });

  it('restricts contact PII to the investigation roles (unchanged)', async () => {
    const l1 = await getByInstanceReference({} as never, 'ca-1', 'level1_analyst') as Record<string, unknown>;
    expect(l1.contactPiiRestricted).toBe(true);
    expect(l1.customerEmailAddress).toBeUndefined();

    const auditor = await getByInstanceReference({} as never, 'ca-1', 'security_auditor') as Record<string, unknown>;
    expect(auditor.contactPiiRestricted).toBe(false);
    expect(auditor.customerEmailAddress).toBe('luis@example.com');
  });
});

describe('sensitive tier never travels outside the audited escalation path (C2, D-3)', () => {
  it('the auditor gets sensitiveAvailable, not plaintext, without a case', async () => {
    const res = await getByInstanceReference({} as never, 'ca-1', 'security_auditor') as Record<string, unknown>;
    expect(res.sensitive).toBeUndefined();
    expect(res.sensitiveAvailable).toBe(true);
    const serialized = JSON.stringify(res);
    for (const key of SENSITIVE_KEYS) expect(serialized).not.toContain(key);
    expect(serialized).not.toContain('no prior fraud');
  });

  it('an L2 investigator with a valid token and a case receives the audited payload', async () => {
    h.validateToken.mockReturnValue({ valid: true, entry: { caseId: 'case-1' } });
    const res = await getByInstanceReference({} as never, 'ca-1', 'level2_investigator', 'tok') as Record<string, unknown>;
    expect(res.sensitive).toBeDefined();
    // Even there, the deprecated field is gone (ADR-050).
    expect(Object.keys(res.sensitive as Record<string, unknown>)).toEqual([
      'customerAgreementResidentialAddress',
      'customerAgreementRiskNotes',
    ]);
  });

  it('L1 never receives the sensitive tier in any form', async () => {
    const res = await getByInstanceReference({} as never, 'ca-1', 'level1_analyst') as Record<string, unknown>;
    expect(res.sensitive).toBeUndefined();
    expect(res.sensitiveAvailable).toBeUndefined();
  });

  it('audits the disclosure naming the fields actually disclosed (PCI Req 10.2.2)', async () => {
    h.validateToken.mockReturnValue({ valid: true, entry: { caseId: 'case-1' } });
    h.appendAuditEvent.mockClear();
    await getByInstanceReference({} as never, 'ca-1', 'security_auditor', 'tok');
    expect(h.appendAuditEvent).toHaveBeenCalledTimes(1);
    const details = h.appendAuditEvent.mock.calls[0][4];
    expect(details.fields).toEqual([
      'customerAgreementResidentialAddress',
      'customerAgreementRiskNotes',
      'customerAgreementGovernmentID',
      'customerAgreementTaxIDNumber',
    ]);
    expect(details.fields).not.toContain('governmentIdentificationReference');
  });
});

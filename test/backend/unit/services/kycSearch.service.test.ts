/**
 * Unit tests: v27 Queryable Encryption KYC search (searchKyc + getKycSearchRegistry)
 * Source: backend/src/modules/customer/services/customerAgreement.service.ts
 *
 * The QE client + escalation-token validator + audit sink are mocked, so we assert the
 * per-mode MongoDB filter shape (equality / range / substring / prefix / suffix), the
 * server-side validation (reject, not silently drop), and the tier gate on result fields.
 * One QE query type per field maps to one search mode (dev.v27 plan D4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getDbForRole: vi.fn(),
  validateToken: vi.fn().mockReturnValue({ valid: false }),
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
  // v32 C6: the sensitive-tier / encryption-write clients are the same double here.
  getSensitiveTierDb: h.getDbForRole,
  getEncryptionWriteDb: h.getDbForRole,
}));
vi.mock('../../../../backend/src/vendors/security/escalationTokens', () => ({
  validateToken: h.validateToken,
}));
vi.mock('../../../../backend/src/modules/fraud/services/fraudDiagnosis.service', () => ({
  appendAuditEvent: h.appendAuditEvent,
}));

import { searchKyc, getKycSearchRegistry } from '../../../../backend/src/modules/customer/services/customerAgreement.service';
import { PARTY_COLLECTION } from '../../../../backend/src/modules/identity/models/party.model';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../../../backend/src/modules/customer/models/customerAgreement.model';

const party = {
  partyInstanceReference: 'party-001',
  partyName: 'Ana Garcia',
  partyEmailAddress: 'ana@example.com',
  partyMobilePhoneNumber: '+34-600-000-000',
};

const agreement = {
  customerAgreementInstanceReference: 'ca-001',
  partyInstanceReference: 'party-001',
  customerAgreementReference: 'ACC-001',
  customerSegment: 'retail',
  customerAgreementStatus: 'active',
  // decrypted sensitive value present so the L2 path attaches the sensitive block
  customerAgreementResidentialAddress: { streetAddress: '1 St', city: 'Madrid', postalCode: '28001', countryCode: 'ES' },
  // v32: the deprecated field is still on the fixture on purpose, so the tests prove it is never
  // surfaced even when a pre-v32 document still carries it.
  governmentIdentificationReference: 'SYNTH-AG-4821',
  customerAgreementRiskNotes: 'none',
  // v27 structured identity document (lookup tier, the searchable source of truth).
  customerAgreementGovernmentID: {
    type: 'driver_license', number: 'ES123454821', issuingCountry: 'ES', expiryDate: '2031-12-24',
  },
  customerAgreementTaxIDNumber: 'ES12345678',
};

/** Records the last filter passed to find() per collection, returns fixed docs. */
function makeDb() {
  const calls: Record<string, unknown> = {};
  const cursor = (docs: unknown[]) => ({ limit: () => ({ toArray: async () => docs }) });
  const db: any = {
    calls,
    collection: vi.fn((name: string) => ({
      find: (filter: unknown) => { calls[name] = filter; return cursor(name === PARTY_COLLECTION ? [party] : [agreement]); },
      findOne: async () => (name === PARTY_COLLECTION ? party : agreement),
    })),
  };
  return db;
}

beforeEach(() => {
  h.validateToken.mockReturnValue({ valid: false });
  h.getDbForRole.mockReset();
});

describe('getKycSearchRegistry', () => {
  it('lists searchable fields with a mode each and never lists QE:none sensitive fields', () => {
    const reg = getKycSearchRegistry();
    const keys = reg.fields.map((f) => f.key);
    expect(keys).toContain('partyName');
    expect(keys).toContain('taxId');
    expect(keys).toContain('riskScore');
    expect(keys).not.toContain('customerAgreementSourceOfFunds');
    expect(reg.sensitiveResultFields).toContain('customerAgreementResidentialAddress');
    // every field carries exactly one search mode
    for (const f of reg.fields) expect(['substring','prefix','suffix','range','equality']).toContain(f.mode);
  });
});

// All shape/validation tests run as an authorized role (security_auditor); L1 is forbidden.
const AUTH = 'security_auditor';

describe('searchKyc filter shapes', () => {
  it('substring on partyName uses the QE contains operator over $partyName (when text search enabled)', async () => {
    const reg = getKycSearchRegistry();
    if (reg.fields.find((f) => f.key === 'partyName')!.mode !== 'substring') return; // gated off: skip
    const db = makeDb();
    h.getDbForRole.mockResolvedValue(db);
    await searchKyc({ field: 'partyName', value: 'garcia' }, AUTH);
    expect(JSON.stringify(db.calls[PARTY_COLLECTION])).toContain('$encStrContains');
    expect(JSON.stringify(db.calls[PARTY_COLLECTION])).toContain('$partyName');
  });

  it('prefix on taxId uses starts-with; suffix on govIdNumber uses ends-with', async () => {
    const reg = getKycSearchRegistry();
    const db = makeDb();
    h.getDbForRole.mockResolvedValue(db);
    if (reg.fields.find((f) => f.key === 'taxId')!.mode === 'prefix') {
      await searchKyc({ field: 'taxId', value: 'ES' }, AUTH);
      expect(JSON.stringify(db.calls[CUSTOMER_AGREEMENT_COLLECTION])).toContain('$encStrStartsWith');
    }
    if (reg.fields.find((f) => f.key === 'govIdNumber')!.mode === 'suffix') {
      await searchKyc({ field: 'govIdNumber', value: '4821' }, AUTH);
      expect(JSON.stringify(db.calls[CUSTOMER_AGREEMENT_COLLECTION])).toContain('$encStrEndsWith');
    }
  });

  it('range on riskScore builds a $gte/$lte filter on the nested path', async () => {
    const db = makeDb();
    h.getDbForRole.mockResolvedValue(db);
    await searchKyc({ field: 'riskScore', from: '70', to: '100' }, AUTH);
    const f = db.calls[CUSTOMER_AGREEMENT_COLLECTION] as Record<string, any>;
    const cond = f['customerAgreementKycCheck.customerAgreementKycCheckRiskScore'];
    expect(cond.$gte).toBe(70);
    expect(cond.$lte).toBe(100);
  });

  it('range on partyDateOfBirth coerces ISO strings to Date bounds', async () => {
    const db = makeDb();
    h.getDbForRole.mockResolvedValue(db);
    await searchKyc({ field: 'partyDateOfBirth', from: '1990-01-01', to: '2000-01-01' }, AUTH);
    const cond = (db.calls[PARTY_COLLECTION] as Record<string, any>)['partyDateOfBirth'];
    expect(cond.$gte).toBeInstanceOf(Date);
    expect(cond.$lte).toBeInstanceOf(Date);
  });

  it('equality on nationality builds an exact-match filter', async () => {
    const db = makeDb();
    h.getDbForRole.mockResolvedValue(db);
    await searchKyc({ field: 'partyNationality', value: 'ES' }, AUTH);
    expect((db.calls[PARTY_COLLECTION] as Record<string, unknown>)['partyNationality']).toBe('ES');
  });
});

describe('searchKyc role gate (least-privilege, PCI DSS Req 7)', () => {
  beforeEach(() => h.getDbForRole.mockResolvedValue(makeDb()));

  it('forbids Level 1 analyst (blind lookup only) with 403', async () => {
    await expect(searchKyc({ field: 'partyNationality', value: 'ES' }, 'level1_analyst'))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('forbids customer with 403', async () => {
    await expect(searchKyc({ field: 'partyNationality', value: 'ES' }, 'customer'))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows level2 investigator and security auditor', async () => {
    await expect(searchKyc({ field: 'partyNationality', value: 'ES' }, 'level2_investigator')).resolves.toBeDefined();
    await expect(searchKyc({ field: 'partyNationality', value: 'ES' }, 'security_auditor')).resolves.toBeDefined();
  });
});

describe('searchKyc validation (reject, not silently drop)', () => {
  beforeEach(() => h.getDbForRole.mockResolvedValue(makeDb()));

  it('rejects an unknown / non-searchable field with 400', async () => {
    await expect(searchKyc({ field: 'customerAgreementSourceOfFunds', value: 'salary' }, AUTH))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a substring shorter than the min query length', async () => {
    const reg = getKycSearchRegistry();
    if (reg.fields.find((f) => f.key === 'partyName')!.mode !== 'substring') return;
    await expect(searchKyc({ field: 'partyName', value: 'ab' }, AUTH)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an out-of-enum equality value', async () => {
    await expect(searchKyc({ field: 'riskRating', value: 'extreme' }, AUTH)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a range with neither from nor to', async () => {
    await expect(searchKyc({ field: 'riskScore' }, AUTH)).rejects.toMatchObject({ statusCode: 400 });
  });
});

// The QE preview indexes cap the query length (strMaxQueryLength). A full document ID is longer
// than that cap, and an operator holding the full ID must still get the record instead of an empty
// result that reads as a broken system. The encrypted query runs on the permitted window and the
// full value is refined against the decrypted result. The db double ignores the filter and always
// returns the fixture, so these tests assert the refinement, not the driver.
describe('searchKyc query window beyond the QE index limit', () => {
  const full = agreement.customerAgreementGovernmentID.number;  // 'ES123454821', longer than 10

  beforeEach(() => h.getDbForRole.mockResolvedValue(makeDb()));

  it('queries the last permitted characters for a suffix field and still returns the record', async () => {
    const db = makeDb();
    h.getDbForRole.mockResolvedValue(db);
    const rows = await searchKyc({ field: 'govIdNumber', value: full }, AUTH);
    const sent = JSON.stringify(db.calls[CUSTOMER_AGREEMENT_COLLECTION]);
    expect(sent).toContain(full.slice(-10));
    expect(sent).not.toContain(full);        // the surplus never reaches the encrypted index
    expect(rows).toHaveLength(1);
  });

  it('refines away a candidate that matches the window but not the full value', async () => {
    const rows = await searchKyc({ field: 'govIdNumber', value: `X${full}` }, AUTH);
    expect(rows).toHaveLength(0);
  });

  it('keeps exact-window queries unrefined (the encrypted result is already exact)', async () => {
    const rows = await searchKyc({ field: 'govIdNumber', value: '4821' }, AUTH);
    expect(rows).toHaveLength(1);
  });

  it('rejects a value longer than the field input limit', async () => {
    const reg = getKycSearchRegistry();
    const def = reg.fields.find((f) => f.key === 'govIdNumber')!;
    const max = def.inputMaxLength ?? def.maxQueryLength ?? 10;
    await expect(searchKyc({ field: 'govIdNumber', value: 'X'.repeat(max + 1) }, AUTH))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('exposes an input limit at least as large as the QE window for every text field', () => {
    for (const f of getKycSearchRegistry().fields) {
      if (!['substring', 'prefix', 'suffix'].includes(f.mode)) continue;
      expect(f.inputMaxLength).toBeGreaterThanOrEqual(f.maxQueryLength ?? 0);
    }
  });
});

describe('searchKyc tier gate on result fields', () => {
  // v32 C2/D-3: a search result never carries QE:none plaintext. The auditor is told the
  // sensitive tier is available and must call the reveal endpoint, which emits one compliance
  // event per disclosure (PCI DSS). Contact PII is lookup tier and still travels.
  it('security auditor gets sensitiveAvailable (not plaintext) and contact PII', async () => {
    h.getDbForRole.mockResolvedValue(makeDb());
    const rows = await searchKyc({ field: 'partyNationality', value: 'ES' }, 'security_auditor');
    expect(rows[0].sensitive).toBeUndefined();
    expect(rows[0].sensitiveAvailable).toBe(true);
    expect(rows[0].customerEmailAddress).toBe('ana@example.com');
  });

  // v32 B1: the identity document is lookup tier, so every role that reaches the record sees the
  // same searchable value (plan §4.1). This is what makes a suffix search on the displayed
  // number possible, and it is the regression guard for the SYNTH-* defect.
  it('returns the structured identity document to every role that can search', async () => {
    h.getDbForRole.mockResolvedValue(makeDb());
    for (const role of ['security_auditor', 'level2_investigator'] as const) {
      const rows = await searchKyc({ field: 'partyNationality', value: 'ES' }, role);
      expect(rows[0].customerAgreementGovernmentID).toEqual(agreement.customerAgreementGovernmentID);
      expect(rows[0].customerAgreementTaxIDNumber).toBe(agreement.customerAgreementTaxIDNumber);
      expect(JSON.stringify(rows[0])).not.toContain('SYNTH-');
    }
  });

  it('L2 investigator sees sensitive fields only with a valid escalation token', async () => {
    h.getDbForRole.mockResolvedValue(makeDb());
    h.validateToken.mockReturnValue({ valid: false });
    let rows = await searchKyc({ field: 'partyNationality', value: 'ES' }, 'level2_investigator');
    expect(rows[0].sensitive).toBeUndefined();

    h.validateToken.mockReturnValue({ valid: true, entry: { caseId: 'case-1' } });
    rows = await searchKyc({ field: 'partyNationality', value: 'ES' }, 'level2_investigator', 'tok');
    expect(rows[0].sensitive).toBeDefined();
  });
});

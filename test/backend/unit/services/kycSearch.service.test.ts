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
  governmentIdentificationReference: 'ID-4821',
  customerAgreementRiskNotes: 'none',
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

describe('searchKyc tier gate on result fields', () => {
  it('security auditor gets the sensitive block and contact PII', async () => {
    h.getDbForRole.mockResolvedValue(makeDb());
    const rows = await searchKyc({ field: 'partyNationality', value: 'ES' }, 'security_auditor');
    expect(rows[0].sensitive).toBeDefined();
    expect(rows[0].customerEmailAddress).toBe('ana@example.com');
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

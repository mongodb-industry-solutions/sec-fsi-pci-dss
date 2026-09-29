/**
 * Unit tests: v32 B3 setup+seed as the single source of truth (test 15)
 * Source: backend/src/vendors/seed/seedCustomers.ts (enrichKyc) + backend/data/customerAgreements.json
 *
 * P7: the data model is applied only from setup/ + seed/, where "seeders" means BOTH the generator
 * code and the JSON fixtures. The v32 government-ID defect was exactly a drift between those two
 * halves: the fixtures kept writing a deprecated SYNTH-* placeholder that the generator never
 * reconciled with the real, searchable customerAgreementGovernmentID.number.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The QE clients are not needed here; the registry is read for its real minQueryLength so the
// seed assertion and the search contract cannot drift (P1: one source, not a copied constant).
vi.mock('../../../../../psp/backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: vi.fn(), getSensitiveTierDb: vi.fn(), getEncryptionWriteDb: vi.fn(),
}));

import { enrichKyc } from '../../../../../psp/backend/src/vendors/seed/seedCustomers';
import { getKycSearchRegistry } from '../../../../../psp/backend/src/modules/customer/services/customerAgreement.service';

const FIXTURES = join(process.cwd(), 'psp', 'backend', 'data', 'customerAgreements.json');
const records = JSON.parse(readFileSync(FIXTURES, 'utf-8')) as Array<Record<string, unknown>>;

const govIdField = getKycSearchRegistry().fields.find((f) => f.key === 'govIdNumber');
const GOV_SUFFIX_MIN = govIdField?.minQueryLength ?? 3;

describe('fixtures (backend/data/customerAgreements.json)', () => {
  it('contains records', () => {
    expect(records.length).toBeGreaterThan(0);
  });

  it('never carries the deprecated governmentIdentificationReference', () => {
    const offenders = records
      .filter((r) => 'governmentIdentificationReference' in r)
      .map((r) => r.customerAgreementInstanceReference);
    expect(offenders).toEqual([]);
  });

  it('contains no SYNTH- placeholder anywhere', () => {
    expect(JSON.stringify(records)).not.toContain('SYNTH-');
  });
});

describe('enrichKyc (generator)', () => {
  it('never writes the deprecated field, even if a fixture still had it', () => {
    const rec: Record<string, unknown> = {
      customerAgreementInstanceReference: 'ca-legacy',
      governmentIdentificationReference: 'SYNTH-XX-0001',
    };
    enrichKyc(rec as never);
    expect(rec.governmentIdentificationReference).toBeUndefined();
  });

  it('produces a complete, searchable identity document for a generated record', () => {
    const rec: Record<string, unknown> = { customerAgreementInstanceReference: 'ca-generated-1' };
    enrichKyc(rec as never);
    const gov = rec.customerAgreementGovernmentID as Record<string, unknown>;
    expect(gov.type).toBeTruthy();
    expect(gov.issuingCountry).toBeTruthy();
    expect(gov.expiryDate).toBeInstanceOf(Date);
    expect(typeof gov.number).toBe('string');
    // Long enough that the last-4 suffix query the demo relies on is above strMinQueryLength.
    expect((gov.number as string).length).toBeGreaterThanOrEqual(GOV_SUFFIX_MIN);
    expect(rec.customerAgreementTaxIDNumber).toBeTruthy();
    expect(rec.customerAgreementOccupation).toBeTruthy();
  });

  it('preserves a hand-written identity document (fixtures win over generation)', () => {
    const rec: Record<string, unknown> = {
      customerAgreementInstanceReference: 'ca-fixture-1',
      customerAgreementGovernmentID: { type: 'driver_license', number: 'GB31454621', issuingCountry: 'GB' },
    };
    enrichKyc(rec as never);
    expect((rec.customerAgreementGovernmentID as Record<string, unknown>).number).toBe('GB31454621');
  });

  it('is deterministic for the same instance reference', () => {
    const a: Record<string, unknown> = { customerAgreementInstanceReference: 'ca-det' };
    const b: Record<string, unknown> = { customerAgreementInstanceReference: 'ca-det' };
    enrichKyc(a as never);
    enrichKyc(b as never);
    expect((a.customerAgreementGovernmentID as Record<string, unknown>).number)
      .toBe((b.customerAgreementGovernmentID as Record<string, unknown>).number);
  });
});

describe('fixtures agree with what the generator would enforce', () => {
  it('every fixture ends up with a complete identity document after enrichment', () => {
    for (const rec of records) {
      const copy = JSON.parse(JSON.stringify(rec)) as Record<string, unknown>;
      enrichKyc(copy as never);
      const gov = copy.customerAgreementGovernmentID as Record<string, unknown>;
      expect(gov, String(rec.customerAgreementInstanceReference)).toBeTruthy();
      for (const leaf of ['type', 'number', 'issuingCountry', 'expiryDate']) {
        expect(gov[leaf], `${rec.customerAgreementInstanceReference}.${leaf}`).toBeTruthy();
      }
      expect((gov.number as string).length).toBeGreaterThanOrEqual(GOV_SUFFIX_MIN);
      expect(copy.governmentIdentificationReference).toBeUndefined();
    }
  });
});

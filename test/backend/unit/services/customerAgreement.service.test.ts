/**
 * Unit tests: customerAgreement.service (FR-v1-04)
 * Source: backend/src/services/customerAgreement.service.ts
 *
 * Key invariant: QE equality-search fields (email, phone, accountRef) are used only
 * as predicates and must NEVER appear in the response (ADR-003 + PCI DSS data minimisation).
 */
import { describe, it, expect, vi } from 'vitest';
import { getByEmail, getByPhone, getByAccountRef } from '../../../../backend/src/services/customerAgreement.service';

const mockAgreement = {
  customerAgreementInstanceReference: 'ca-001',
  // QE equality fields — search predicates, stripped from response
  customerEmailAddress: 'customer@example.com',
  customerMobilePhoneNumber: '+1-555-0001',
  customerAgreementReference: 'ACC-REF-001',
  // Safe fields returned to caller
  customerName: 'John Doe',
  customerAgreementType: 'personal',
  bianServiceDomain: 'CustomerAgreement',
  recordCreatedDateTime: new Date(),
  recordUpdatedDateTime: new Date(),
};

function makeDb(doc: typeof mockAgreement | null) {
  return {
    collection: vi.fn().mockReturnValue({
      findOne: vi.fn().mockResolvedValue(doc),
    }),
  } as any;
}

describe('getByEmail', () => {
  it('returns document with safe fields when found', async () => {
    const result = await getByEmail(makeDb(mockAgreement), 'customer@example.com');
    expect(result).not.toBeNull();
    expect(result!.customerName).toBe('John Doe');
  });

  it('strips QE predicate fields from response', async () => {
    const result = await getByEmail(makeDb(mockAgreement), 'customer@example.com');
    expect((result as Record<string, unknown>).customerEmailAddress).toBeUndefined();
    expect((result as Record<string, unknown>).customerMobilePhoneNumber).toBeUndefined();
    expect((result as Record<string, unknown>).customerAgreementReference).toBeUndefined();
  });

  it('queries by customerEmailAddress', async () => {
    const db = makeDb(mockAgreement);
    await getByEmail(db, 'customer@example.com');
    expect(db.collection().findOne).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmailAddress: 'customer@example.com' })
    );
  });

  it('returns null when not found', async () => {
    expect(await getByEmail(makeDb(null), 'unknown@example.com')).toBeNull();
  });
});

describe('getByPhone', () => {
  it('returns document with safe fields when found', async () => {
    const result = await getByPhone(makeDb(mockAgreement), '+1-555-0001');
    expect(result!.customerName).toBe('John Doe');
    expect((result as Record<string, unknown>).customerMobilePhoneNumber).toBeUndefined();
  });

  it('queries by customerMobilePhoneNumber', async () => {
    const db = makeDb(mockAgreement);
    await getByPhone(db, '+1-555-0001');
    expect(db.collection().findOne).toHaveBeenCalledWith(
      expect.objectContaining({ customerMobilePhoneNumber: '+1-555-0001' })
    );
  });

  it('returns null when not found', async () => {
    expect(await getByPhone(makeDb(null), '+0-000-0000')).toBeNull();
  });
});

describe('getByAccountRef', () => {
  it('returns document with safe fields when found', async () => {
    const result = await getByAccountRef(makeDb(mockAgreement), 'ACC-REF-001');
    expect(result!.customerName).toBe('John Doe');
    expect((result as Record<string, unknown>).customerAgreementReference).toBeUndefined();
  });

  it('queries by customerAgreementReference', async () => {
    const db = makeDb(mockAgreement);
    await getByAccountRef(db, 'ACC-REF-001');
    expect(db.collection().findOne).toHaveBeenCalledWith(
      expect.objectContaining({ customerAgreementReference: 'ACC-REF-001' })
    );
  });

  it('returns null when not found', async () => {
    expect(await getByAccountRef(makeDb(null), 'UNKNOWN')).toBeNull();
  });
});

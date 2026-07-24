/**
 * Unit tests: customerAgreement.service (FR-v1-04)
 * Source: backend/src/modules/customer/services/customerAgreement.service.ts
 *
 * The service now resolves a role-aware QE client (getDbForRole) and joins the PII-
 * bearing `party` record (SD-13) with the `customerAgreementProcedure` record. The
 * QE client and escalation-token validator are mocked so the join + response shaping
 * are tested in isolation. Sensitive fields (address/govId/riskNotes) only appear when
 * the underlying field is decrypted (L2 client); for the L1 default they are omitted.
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getDbForRole: vi.fn(),
  validateToken: vi.fn().mockReturnValue({ valid: false }),
}));

vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
}));
vi.mock('../../../../backend/src/vendors/security/escalationTokens', () => ({
  validateToken: h.validateToken,
}));

import { getByEmail, getByPhone, getByAccountRef } from '../../../../backend/src/modules/customer/services/customerAgreement.service';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../../../backend/src/modules/customer/models/customerAgreement.model';
import { phoneDigest } from '../../../../backend/src/vendors/encryption/digest';
import { PARTY_COLLECTION } from '../../../../backend/src/modules/identity/models/party.model';

const party = {
  partyInstanceReference: 'party-001',
  partyName: 'John Doe',
  partyEmailAddress: 'customer@example.com',
  partyMobilePhoneNumber: '+1-555-0001',
};

const agreement = {
  customerAgreementInstanceReference: 'ca-001',
  partyInstanceReference: 'party-001',
  customerAgreementReference: 'ACC-REF-001',
  customerSegment: 'retail',
  customerAgreementStatus: 'active',
  bianServiceDomain: 'CustomerAgreement',
  bianControlRecordType: 'CustomerAgreementProcedure',
  // no customerAgreementResidentialAddress → isSensitiveDecrypted() is false → no sensitive block
};

/** Mock role-aware Db that returns `party` / `agreement` per collection name. */
function makeRoleDb(partyDoc: typeof party | null, agreementDoc: typeof agreement | null) {
  const partyFindOne = vi.fn().mockResolvedValue(partyDoc);
  const agreementFindOne = vi.fn().mockResolvedValue(agreementDoc);
  const db: any = {
    partyFindOne,
    agreementFindOne,
    collection: vi.fn((name: string) => ({
      findOne: name === PARTY_COLLECTION ? partyFindOne : agreementFindOne,
    })),
  };
  return db;
}

describe('getByEmail', () => {
  it('returns the joined safe fields when found', async () => {
    h.getDbForRole.mockResolvedValue(makeRoleDb(party, agreement));
    const result = await getByEmail({} as any, 'customer@example.com');
    expect(result).not.toBeNull();
    expect(result!.customerName).toBe('John Doe');
  });

  it('restricts contact PII for L1 but exposes the account reference (PCI DSS Req 7 least-privilege)', async () => {
    // Contact PII (email/phone) is now gated to L2 investigator / security auditor (need-to-know).
    // The default L1 analyst triages on non-identifying attributes; the account reference is not PII-gated.
    h.getDbForRole.mockResolvedValue(makeRoleDb(party, agreement));
    const result = await getByEmail({} as any, 'customer@example.com'); // default role = level1_analyst
    expect(result!.customerEmailAddress).toBeUndefined();
    expect(result!.customerMobilePhoneNumber).toBeUndefined();
    expect(result!.contactPiiRestricted).toBe(true);
    expect(result!.customerAgreementReference).toBe('ACC-REF-001');
  });

  it('omits the sensitive block for the L1 client (encrypted address not decrypted)', async () => {
    h.getDbForRole.mockResolvedValue(makeRoleDb(party, agreement));
    const result = await getByEmail({} as any, 'customer@example.com');
    expect((result as Record<string, unknown>).sensitive).toBeUndefined();
  });

  it('queries party by partyEmailAddress', async () => {
    const db = makeRoleDb(party, agreement);
    h.getDbForRole.mockResolvedValue(db);
    await getByEmail({} as any, 'customer@example.com');
    expect(db.partyFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ partyEmailAddress: 'customer@example.com' })
    );
  });

  it('returns null when the party is not found', async () => {
    h.getDbForRole.mockResolvedValue(makeRoleDb(null, null));
    expect(await getByEmail({} as any, 'unknown@example.com')).toBeNull();
  });
});

describe('getByPhone', () => {
  it('returns the joined safe fields when found', async () => {
    h.getDbForRole.mockResolvedValue(makeRoleDb(party, agreement));
    const result = await getByPhone({} as any, '+1-555-0001');
    expect(result!.customerName).toBe('John Doe');
  });

  it('queries party by the normalized phone blind-index digest (space-insensitive)', async () => {
    const db = makeRoleDb(party, agreement);
    h.getDbForRole.mockResolvedValue(db);
    await getByPhone({} as any, '+1-555-0001');
    // Spaced and unspaced inputs must resolve to the same digest, so the query matches on the digest.
    const expectedDigest = phoneDigest('+1 555 0001');
    expect(phoneDigest('+1-555-0001')).toBe(expectedDigest);
    expect(db.partyFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ partyMobilePhoneNumberDigest: expectedDigest })
    );
  });

  it('returns null when not found', async () => {
    h.getDbForRole.mockResolvedValue(makeRoleDb(null, null));
    expect(await getByPhone({} as any, '+0-000-0000')).toBeNull();
  });
});

describe('getByAccountRef', () => {
  it('returns the joined safe fields when found', async () => {
    h.getDbForRole.mockResolvedValue(makeRoleDb(party, agreement));
    const result = await getByAccountRef({} as any, 'ACC-REF-001');
    expect(result!.customerName).toBe('John Doe');
  });

  it('queries the agreement by customerAgreementReference', async () => {
    const db = makeRoleDb(party, agreement);
    h.getDbForRole.mockResolvedValue(db);
    await getByAccountRef({} as any, 'ACC-REF-001');
    expect(db.agreementFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ customerAgreementReference: 'ACC-REF-001' })
    );
  });

  it('returns null when not found', async () => {
    h.getDbForRole.mockResolvedValue(makeRoleDb(null, null));
    expect(await getByAccountRef({} as any, 'UNKNOWN')).toBeNull();
  });
});

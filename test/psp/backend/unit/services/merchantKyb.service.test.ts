/**
 * Unit tests (v31): KYB beneficial-owner CRUD service (invariant enforcement + primary reassignment).
 * Source: backend/src/modules/gateway/services/merchantKyb.service.ts
 *
 * Uses a mocked Db: merchantAgreementProcedure.findOne returns the current merchant; updateOne records
 * the committed owner array + derived primary pointer; party.findOne validates the referenced party.
 */
import { describe, it, expect, vi } from 'vitest';
import { addBeneficialOwner, updateBeneficialOwner, removeBeneficialOwner } from '../../../../../psp/backend/src/modules/gateway/services/merchantKyb.service';
import { MerchantBeneficialOwner } from '../../../../../psp/backend/src/modules/gateway/models/merchantAgreement.model';

vi.mock('../../../../../psp/backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitComplianceEvent: vi.fn(),
}));

const owner = (over: Partial<MerchantBeneficialOwner>): MerchantBeneficialOwner => ({
  merchantBeneficialOwnerPartyReference: 'p-1',
  merchantBeneficialOwnerRole: 'ultimate_beneficial_owner',
  merchantBeneficialOwnerOwnershipPercentage: 100,
  merchantBeneficialOwnerIsPrimary: true,
  merchantBeneficialOwnerIsControllingPerson: true,
  merchantBeneficialOwnerAddedDateTime: new Date(),
  ...over,
});

function makeDb(merchant: Record<string, unknown>, opts?: { partyExists?: boolean }) {
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const insertOne = vi.fn().mockResolvedValue({});
  const collection = vi.fn((name: string) => {
    if (name === 'merchantAgreementProcedure') return { findOne: vi.fn().mockResolvedValue(merchant), updateOne };
    if (name === 'party') return { findOne: vi.fn().mockResolvedValue((opts?.partyExists ?? true) ? { partyInstanceReference: 'x' } : null) };
    return { findOne: vi.fn().mockResolvedValue(null), insertOne, find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) };
  });
  return { db: { collection } as never, updateOne };
}

const baseMerchant = () => ({
  merchantAgreementInstanceReference: 'm-1',
  merchantOwnerPartyReference: 'p-1',
  recordUpdatedDateTime: new Date('2026-01-01'),
  merchantBeneficialOwners: [owner({ merchantBeneficialOwnerPartyReference: 'p-1', merchantBeneficialOwnerOwnershipPercentage: 60 })],
});

describe('addBeneficialOwner', () => {
  it('adds a valid second owner and derives the primary pointer', async () => {
    const { db, updateOne } = makeDb(baseMerchant());
    const r = await addBeneficialOwner(db, 'm-1', { merchantBeneficialOwnerPartyReference: 'p-2', merchantBeneficialOwnerRole: 'shareholder', merchantBeneficialOwnerOwnershipPercentage: 40 }, {});
    expect(r.status).toBe('ok');
    const set = updateOne.mock.calls[0][1].$set;
    expect(set.merchantBeneficialOwners).toHaveLength(2);
    expect(set.merchantOwnerPartyReference).toBe('p-1'); // primary unchanged
  });

  it('rejects a sum over 100', async () => {
    const { db } = makeDb(baseMerchant());
    const r = await addBeneficialOwner(db, 'm-1', { merchantBeneficialOwnerPartyReference: 'p-2', merchantBeneficialOwnerRole: 'shareholder', merchantBeneficialOwnerOwnershipPercentage: 50 }, {});
    expect(r.status).toBe('invalid'); // 60 + 50 = 110
  });

  it('rejects a non-existent party', async () => {
    const { db } = makeDb(baseMerchant(), { partyExists: false });
    const r = await addBeneficialOwner(db, 'm-1', { merchantBeneficialOwnerPartyReference: 'ghost', merchantBeneficialOwnerRole: 'shareholder', merchantBeneficialOwnerOwnershipPercentage: 10 }, {});
    expect(r.status).toBe('invalid');
  });

  it('rejects a duplicate owner', async () => {
    const { db } = makeDb(baseMerchant());
    const r = await addBeneficialOwner(db, 'm-1', { merchantBeneficialOwnerPartyReference: 'p-1', merchantBeneficialOwnerRole: 'shareholder', merchantBeneficialOwnerOwnershipPercentage: 10 }, {});
    expect(r.status).toBe('invalid');
  });
});

describe('updateBeneficialOwner (primary reassignment)', () => {
  const twoOwners = () => ({
    merchantAgreementInstanceReference: 'm-1',
    merchantOwnerPartyReference: 'p-1',
    recordUpdatedDateTime: new Date('2026-01-01'),
    merchantBeneficialOwners: [
      owner({ merchantBeneficialOwnerPartyReference: 'p-1', merchantBeneficialOwnerOwnershipPercentage: 60, merchantBeneficialOwnerIsPrimary: true }),
      owner({ merchantBeneficialOwnerPartyReference: 'p-2', merchantBeneficialOwnerOwnershipPercentage: 40, merchantBeneficialOwnerIsPrimary: false, merchantBeneficialOwnerRole: 'shareholder', merchantBeneficialOwnerIsControllingPerson: true }),
    ],
  });

  it('promotes a new primary and demotes the previous one atomically', async () => {
    const { db, updateOne } = makeDb(twoOwners());
    const r = await updateBeneficialOwner(db, 'm-1', 'p-2', { merchantBeneficialOwnerIsPrimary: true }, {});
    expect(r.status).toBe('ok');
    const set = updateOne.mock.calls[0][1].$set;
    expect(set.merchantOwnerPartyReference).toBe('p-2');
    const primaries = set.merchantBeneficialOwners.filter((o: MerchantBeneficialOwner) => o.merchantBeneficialOwnerIsPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].merchantBeneficialOwnerPartyReference).toBe('p-2');
  });
});

describe('removeBeneficialOwner (guards)', () => {
  it('blocks removing the last owner', async () => {
    const { db } = makeDb(baseMerchant());
    const r = await removeBeneficialOwner(db, 'm-1', 'p-1', {});
    expect(r.status).toBe('invalid');
  });

  it('blocks removing the primary while others remain', async () => {
    const merchant = {
      merchantAgreementInstanceReference: 'm-1',
      merchantOwnerPartyReference: 'p-1',
      recordUpdatedDateTime: new Date('2026-01-01'),
      merchantBeneficialOwners: [
        owner({ merchantBeneficialOwnerPartyReference: 'p-1', merchantBeneficialOwnerOwnershipPercentage: 60, merchantBeneficialOwnerIsPrimary: true }),
        owner({ merchantBeneficialOwnerPartyReference: 'p-2', merchantBeneficialOwnerOwnershipPercentage: 40, merchantBeneficialOwnerIsPrimary: false }),
      ],
    };
    const { db } = makeDb(merchant);
    const r = await removeBeneficialOwner(db, 'm-1', 'p-1', {});
    expect(r.status).toBe('invalid');
  });

  it('removes a minority owner and keeps invariants', async () => {
    const merchant = {
      merchantAgreementInstanceReference: 'm-1',
      merchantOwnerPartyReference: 'p-1',
      recordUpdatedDateTime: new Date('2026-01-01'),
      merchantBeneficialOwners: [
        owner({ merchantBeneficialOwnerPartyReference: 'p-1', merchantBeneficialOwnerOwnershipPercentage: 60, merchantBeneficialOwnerIsPrimary: true }),
        owner({ merchantBeneficialOwnerPartyReference: 'p-2', merchantBeneficialOwnerOwnershipPercentage: 40, merchantBeneficialOwnerIsPrimary: false }),
      ],
    };
    const { db, updateOne } = makeDb(merchant);
    const r = await removeBeneficialOwner(db, 'm-1', 'p-2', {});
    expect(r.status).toBe('ok');
    expect(updateOne.mock.calls[0][1].$set.merchantBeneficialOwners).toHaveLength(1);
  });
});

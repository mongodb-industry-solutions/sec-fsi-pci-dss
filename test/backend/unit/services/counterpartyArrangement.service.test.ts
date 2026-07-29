/**
 * Unit tests: beneficiary registry — re-add after soft-delete (SD-54)
 * Source: backend/src/modules/identity/services/counterpartyArrangement.service.ts (registerBeneficiary)
 *
 * Requirement: DELETE soft-deletes an arrangement (status='removed') but the unique index on
 * (ownerPartyReference, counterpartyPartyReference) still covers it. Re-adding the same beneficiary
 * must REACTIVATE the removed record instead of inserting a duplicate (which would collide on the
 * unique index and fail). An already-active arrangement stays anti-enumeration safe (found:false).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const OWNER = 'party-owner-1';
const COUNTERPARTY = 'party-counterparty-2';

// Party resolved by QE lookup for phone/email.
const h = vi.hoisted(() => {
  const partyFindOne = vi.fn();
  const qeDb = { collection: vi.fn(() => ({ findOne: partyFindOne })) };
  return { partyFindOne, qeDb, getDbForRole: vi.fn().mockResolvedValue(qeDb) };
});

vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({
  getDbForRole: h.getDbForRole,
}));

import { registerBeneficiary } from '../../../../backend/src/modules/identity/services/counterpartyArrangement.service';

function makeCol() {
  return {
    countDocuments: vi.fn().mockResolvedValue(0),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
}

function makeDb(col: ReturnType<typeof makeCol>) {
  return { collection: vi.fn(() => col) } as never;
}

describe('registerBeneficiary — re-add after soft-delete (SD-54)', () => {
  beforeEach(() => {
    h.partyFindOne.mockReset();
    h.partyFindOne.mockResolvedValue({ partyInstanceReference: COUNTERPARTY });
  });

  it('reactivates a soft-deleted arrangement instead of inserting a duplicate', async () => {
    const col = makeCol();
    col.findOne.mockResolvedValue({
      counterpartyArrangementReference: 'arr-1',
      ownerPartyReference: OWNER,
      counterpartyPartyReference: COUNTERPARTY,
      counterpartyArrangementStatus: 'removed',
    });

    const result = await registerBeneficiary(makeDb(col), {
      ownerPartyReference: OWNER,
      lookupType: 'email',
      lookupValue: 'jane@example.com',
      label: 'Jane',
    });

    expect(col.insertOne).not.toHaveBeenCalled();
    expect(col.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = col.updateOne.mock.calls[0];
    expect(filter).toEqual({
      counterpartyArrangementReference: 'arr-1',
      ownerPartyReference: OWNER,
      counterpartyArrangementStatus: 'removed',
    });
    expect((update as { $set: Record<string, unknown> }).$set).toMatchObject({
      counterpartyArrangementStatus: 'active',
      counterpartyLabel: 'Jane',
      counterpartyLookupType: 'email',
    });
    expect(result).toMatchObject({ found: true, counterpartyArrangementReference: 'arr-1' });
  });

  it('returns found:false for an already-active arrangement (anti-enumeration)', async () => {
    const col = makeCol();
    col.findOne.mockResolvedValue({
      counterpartyArrangementReference: 'arr-1',
      ownerPartyReference: OWNER,
      counterpartyPartyReference: COUNTERPARTY,
      counterpartyArrangementStatus: 'active',
    });

    const result = await registerBeneficiary(makeDb(col), {
      ownerPartyReference: OWNER,
      lookupType: 'phone',
      lookupValue: '+34612345678',
    });

    expect(result).toEqual({ found: false });
    expect(col.updateOne).not.toHaveBeenCalled();
    expect(col.insertOne).not.toHaveBeenCalled();
  });

  it('inserts a new arrangement when none exists for the pair', async () => {
    const col = makeCol();

    const result = await registerBeneficiary(makeDb(col), {
      ownerPartyReference: OWNER,
      lookupType: 'email',
      lookupValue: 'jane@example.com',
      label: 'Jane',
    });

    expect(col.insertOne).toHaveBeenCalledTimes(1);
    expect(col.updateOne).not.toHaveBeenCalled();
    const inserted = col.insertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      ownerPartyReference: OWNER,
      counterpartyPartyReference: COUNTERPARTY,
      counterpartyArrangementStatus: 'active',
    });
    expect(result).toMatchObject({ found: true });
  });
});

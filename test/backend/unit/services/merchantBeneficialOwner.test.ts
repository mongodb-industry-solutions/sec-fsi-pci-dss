/**
 * Unit tests (v31): merchant beneficial-owner invariants (plan §3.2).
 * Source: backend/src/modules/gateway/services/merchantBeneficialOwner.ts
 *
 * Invariants: length >= 1; exactly one primary; per-owner 0..100; sum <= 100 (epsilon);
 * primary = largest shareholder (soft); FATF controlling-person (soft); isMerchantOwner over array.
 */
import { describe, it, expect } from 'vitest';
import {
  validateBeneficialOwners,
  isMerchantOwner,
  derivePrimaryOwnerRef,
  ownershipSum,
  computeIsControllingPerson,
} from '../../../../backend/src/modules/gateway/services/merchantBeneficialOwner';
import { MerchantBeneficialOwner } from '../../../../backend/src/modules/gateway/models/merchantAgreement.model';

const owner = (over: Partial<MerchantBeneficialOwner>): MerchantBeneficialOwner => ({
  merchantBeneficialOwnerPartyReference: 'p-1',
  merchantBeneficialOwnerRole: 'ultimate_beneficial_owner',
  merchantBeneficialOwnerOwnershipPercentage: 100,
  merchantBeneficialOwnerIsPrimary: true,
  merchantBeneficialOwnerIsControllingPerson: true,
  merchantBeneficialOwnerAddedDateTime: new Date(),
  ...over,
});

describe('validateBeneficialOwners', () => {
  it('accepts a single 100% primary owner', () => {
    const r = validateBeneficialOwners([owner({})]);
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it('accepts a realistic 60/40 cap table with one primary', () => {
    const r = validateBeneficialOwners([
      owner({ merchantBeneficialOwnerPartyReference: 'p-1', merchantBeneficialOwnerOwnershipPercentage: 60, merchantBeneficialOwnerIsPrimary: true }),
      owner({ merchantBeneficialOwnerPartyReference: 'p-2', merchantBeneficialOwnerOwnershipPercentage: 40, merchantBeneficialOwnerIsPrimary: false, merchantBeneficialOwnerRole: 'shareholder', merchantBeneficialOwnerIsControllingPerson: true }),
    ]);
    expect(r.ok).toBe(true);
  });

  it('rejects an empty owner set', () => {
    expect(validateBeneficialOwners([]).ok).toBe(false);
  });

  it('rejects zero or multiple primaries', () => {
    expect(validateBeneficialOwners([owner({ merchantBeneficialOwnerIsPrimary: false })]).ok).toBe(false);
    expect(
      validateBeneficialOwners([
        owner({ merchantBeneficialOwnerPartyReference: 'p-1', merchantBeneficialOwnerOwnershipPercentage: 50 }),
        owner({ merchantBeneficialOwnerPartyReference: 'p-2', merchantBeneficialOwnerOwnershipPercentage: 50 }),
      ]).ok,
    ).toBe(false);
  });

  it('rejects a sum over 100', () => {
    const r = validateBeneficialOwners([
      owner({ merchantBeneficialOwnerPartyReference: 'p-1', merchantBeneficialOwnerOwnershipPercentage: 70, merchantBeneficialOwnerIsPrimary: true }),
      owner({ merchantBeneficialOwnerPartyReference: 'p-2', merchantBeneficialOwnerOwnershipPercentage: 40, merchantBeneficialOwnerIsPrimary: false }),
    ]);
    expect(r.ok).toBe(false);
  });

  it('rejects out-of-range participation', () => {
    expect(validateBeneficialOwners([owner({ merchantBeneficialOwnerOwnershipPercentage: 150 })]).ok).toBe(false);
    expect(validateBeneficialOwners([owner({ merchantBeneficialOwnerOwnershipPercentage: -1 })]).ok).toBe(false);
  });

  it('rejects duplicate party references', () => {
    const r = validateBeneficialOwners([
      owner({ merchantBeneficialOwnerPartyReference: 'dup', merchantBeneficialOwnerOwnershipPercentage: 50, merchantBeneficialOwnerIsPrimary: true }),
      owner({ merchantBeneficialOwnerPartyReference: 'dup', merchantBeneficialOwnerOwnershipPercentage: 50, merchantBeneficialOwnerIsPrimary: false }),
    ]);
    expect(r.ok).toBe(false);
  });

  it('warns on free-float sum below 100', () => {
    const r = validateBeneficialOwners([owner({ merchantBeneficialOwnerOwnershipPercentage: 80 })]);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('residual'))).toBe(true);
  });

  it('warns when the primary is not the largest shareholder', () => {
    const r = validateBeneficialOwners([
      owner({ merchantBeneficialOwnerPartyReference: 'p-1', merchantBeneficialOwnerOwnershipPercentage: 30, merchantBeneficialOwnerIsPrimary: true }),
      owner({ merchantBeneficialOwnerPartyReference: 'p-2', merchantBeneficialOwnerOwnershipPercentage: 70, merchantBeneficialOwnerIsPrimary: false, merchantBeneficialOwnerIsControllingPerson: true }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('largest shareholder'))).toBe(true);
  });
});

describe('isMerchantOwner', () => {
  const merchant = {
    merchantOwnerPartyReference: 'primary',
    merchantBeneficialOwners: [
      owner({ merchantBeneficialOwnerPartyReference: 'primary', merchantBeneficialOwnerOwnershipPercentage: 60 }),
      owner({ merchantBeneficialOwnerPartyReference: 'minority', merchantBeneficialOwnerOwnershipPercentage: 40, merchantBeneficialOwnerIsPrimary: false }),
    ],
  };
  it('matches any shareholder, not just the primary', () => {
    expect(isMerchantOwner(merchant, 'primary')).toBe(true);
    expect(isMerchantOwner(merchant, 'minority')).toBe(true);
    expect(isMerchantOwner(merchant, 'stranger')).toBe(false);
    expect(isMerchantOwner(merchant, undefined)).toBe(false);
  });
  it('falls back to the legacy scalar pointer for pre-migration data', () => {
    expect(isMerchantOwner({ merchantOwnerPartyReference: 'legacy' }, 'legacy')).toBe(true);
  });
});

describe('helpers', () => {
  it('derivePrimaryOwnerRef returns the primary party ref', () => {
    expect(
      derivePrimaryOwnerRef([
        owner({ merchantBeneficialOwnerPartyReference: 'a', merchantBeneficialOwnerIsPrimary: false }),
        owner({ merchantBeneficialOwnerPartyReference: 'b', merchantBeneficialOwnerIsPrimary: true }),
      ]),
    ).toBe('b');
  });
  it('ownershipSum rounds to 2 dp', () => {
    expect(ownershipSum([owner({ merchantBeneficialOwnerOwnershipPercentage: 33.33 }), owner({ merchantBeneficialOwnerPartyReference: 'p2', merchantBeneficialOwnerOwnershipPercentage: 33.33, merchantBeneficialOwnerIsPrimary: false })])).toBe(66.66);
  });
  it('computeIsControllingPerson applies the FATF test', () => {
    expect(computeIsControllingPerson({ merchantBeneficialOwnerOwnershipPercentage: 30, merchantBeneficialOwnerRole: 'shareholder' })).toBe(true);
    expect(computeIsControllingPerson({ merchantBeneficialOwnerOwnershipPercentage: 10, merchantBeneficialOwnerRole: 'shareholder' })).toBe(false);
    expect(computeIsControllingPerson({ merchantBeneficialOwnerOwnershipPercentage: 5, merchantBeneficialOwnerRole: 'director' })).toBe(true);
  });
});

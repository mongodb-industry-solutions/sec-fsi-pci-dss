// v31 (SD-89 + SD-13, FATF/4th AMLD): beneficial-owner invariants + ownership helpers.
// Pure, no I/O. Enforced in the service layer (NOT in the DB), per plan §3.2. Reused by controller
// validation, the owners CRUD path, and the seeder so all three apply the identical rules.

import {
  MerchantAgreementControlRecord,
  MerchantBeneficialOwner,
  MERCHANT_BENEFICIAL_OWNERS_MAX,
} from '../models/merchantAgreement.model';

// Ownership % is stored as a number with 2 decimal places. The sum invariant is validated with an
// epsilon to avoid floating-point drift on the `sum <= 100` boundary.
const PCT_EPSILON = 0.001;
export const FATF_CONTROL_THRESHOLD = 25; // > 25% ownership ⇒ controlling person (FATF)

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** True if the party is ANY beneficial owner of the merchant (primary or not). Single source of the
 *  ownership check so no page/handler re-implements it. Falls back to the legacy scalar pointer so
 *  pre-migration records still resolve. */
export function isMerchantOwner(
  merchant: Pick<MerchantAgreementControlRecord, 'merchantBeneficialOwners' | 'merchantOwnerPartyReference'>,
  partyRef: string | undefined | null,
): boolean {
  if (!partyRef) return false;
  const owners = merchant.merchantBeneficialOwners ?? [];
  if (owners.some((o) => o.merchantBeneficialOwnerPartyReference === partyRef)) return true;
  return merchant.merchantOwnerPartyReference === partyRef;
}

/** The primary/controlling owner's party ref (derived pointer kept on merchantOwnerPartyReference). */
export function derivePrimaryOwnerRef(owners: MerchantBeneficialOwner[]): string | undefined {
  return owners.find((o) => o.merchantBeneficialOwnerIsPrimary)?.merchantBeneficialOwnerPartyReference;
}

export function ownershipSum(owners: MerchantBeneficialOwner[]): number {
  return round2(owners.reduce((s, o) => s + (o.merchantBeneficialOwnerOwnershipPercentage || 0), 0));
}

export interface OwnerValidationResult {
  ok: boolean;
  error?: string;
  warnings: string[];
}

/** Enforce the plan §3.2 invariants on the full owner set. Hard failures return ok:false (→ 400);
 *  realistic-but-noteworthy conditions (sum < 100, controlling-person mismatch) are soft warnings. */
export function validateBeneficialOwners(owners: MerchantBeneficialOwner[]): OwnerValidationResult {
  const warnings: string[] = [];
  if (!Array.isArray(owners) || owners.length < 1) {
    return { ok: false, error: 'A merchant must have at least one beneficial owner.', warnings };
  }
  if (owners.length > MERCHANT_BENEFICIAL_OWNERS_MAX) {
    return { ok: false, error: `A merchant may have at most ${MERCHANT_BENEFICIAL_OWNERS_MAX} reportable beneficial owners.`, warnings };
  }

  const refs = new Set<string>();
  for (const o of owners) {
    if (!o.merchantBeneficialOwnerPartyReference) {
      return { ok: false, error: 'Each beneficial owner must reference an existing party.', warnings };
    }
    if (refs.has(o.merchantBeneficialOwnerPartyReference)) {
      return { ok: false, error: `Duplicate beneficial owner party reference: ${o.merchantBeneficialOwnerPartyReference}.`, warnings };
    }
    refs.add(o.merchantBeneficialOwnerPartyReference);

    const pct = o.merchantBeneficialOwnerOwnershipPercentage;
    if (typeof pct !== 'number' || Number.isNaN(pct) || pct < 0 || pct > 100) {
      return { ok: false, error: 'Ownership participation must be a number between 0 and 100.', warnings };
    }
  }

  const primaries = owners.filter((o) => o.merchantBeneficialOwnerIsPrimary);
  if (primaries.length !== 1) {
    return { ok: false, error: 'Exactly one beneficial owner must be the primary/controlling owner.', warnings };
  }

  const sum = ownershipSum(owners);
  if (sum > 100 + PCT_EPSILON) {
    return { ok: false, error: `Total ownership participation (${sum}%) cannot exceed 100%.`, warnings };
  }
  if (sum < 100 - PCT_EPSILON) {
    warnings.push(`Total ownership participation is ${sum}% (residual free-float / minority holders below the reporting threshold).`);
  }

  // The primary should be the largest shareholder unless deliberately flagged otherwise.
  const primary = primaries[0];
  const maxPct = Math.max(...owners.map((o) => o.merchantBeneficialOwnerOwnershipPercentage));
  if (primary.merchantBeneficialOwnerOwnershipPercentage < maxPct - PCT_EPSILON) {
    warnings.push('The primary owner is not the largest shareholder.');
  }

  // FATF control test: > 25% or a board/signatory role ⇒ should be a controlling person.
  for (const o of owners) {
    const expectControl =
      o.merchantBeneficialOwnerOwnershipPercentage > FATF_CONTROL_THRESHOLD ||
      o.merchantBeneficialOwnerRole === 'director' ||
      o.merchantBeneficialOwnerRole === 'authorized_signatory';
    if (expectControl && !o.merchantBeneficialOwnerIsControllingPerson) {
      warnings.push(`Owner ${o.merchantBeneficialOwnerPartyReference} exceeds the FATF control threshold but is not flagged as a controlling person.`);
    }
  }

  return { ok: true, warnings };
}

/** Recompute the FATF controlling-person flag from ownership % + role (soft-normalization helper). */
export function computeIsControllingPerson(owner: Pick<MerchantBeneficialOwner, 'merchantBeneficialOwnerOwnershipPercentage' | 'merchantBeneficialOwnerRole'>): boolean {
  return (
    owner.merchantBeneficialOwnerOwnershipPercentage > FATF_CONTROL_THRESHOLD ||
    owner.merchantBeneficialOwnerRole === 'director' ||
    owner.merchantBeneficialOwnerRole === 'authorized_signatory'
  );
}

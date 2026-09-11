// KYB administration service (v31). Owns the KYB *data* surface: review/correct KYB
// fields, administer beneficial owners (bounded embed), compose owner-layer risk from each UBO's
// KYC verdict, and persist the structured entity-layer verdict from the screening chain.
//
// The KYB *decision* (approve/reject/suspend) stays in merchant.service.reviewMerchantApplication
// (merchant_officer). This service never writes lifecycle status from the data-correction path
// (plan decision 2); the onboarding saga (§5bis) is the only automated status writer.

import { Db } from 'mongodb';
import {
  MERCHANT_AGREEMENT_COLLECTION,
  MerchantAgreementControlRecord,
  MerchantBeneficialOwner,
  MerchantBeneficialOwnerRole,
  MerchantAgreementKybCheck,
} from '../models/merchantAgreement.model';
import { PARTY_COLLECTION, PartyControlRecord } from '../../customer/models/party.model';
import { CUSTOMER_AGREEMENT_COLLECTION, CustomerAgreementControlRecord } from '../../customer/models/customerAgreement.model';
import { emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';
import {
  validateBeneficialOwners,
  derivePrimaryOwnerRef,
  computeIsControllingPerson,
  isMerchantOwner,
} from './merchantBeneficialOwner';
import { appendMerchantEvent } from './merchant.service';
import {
  deriveKybCheckStatus,
  effectiveDecisionMode,
  DecisionMode,
} from '../../../shared/models/onboardingDecision';

// KYB data fields the Administration surface may correct. NEVER includes any status/verdict field
// (those are decision-owned). PII of owners is edited on the party record, not here.
const KYB_EDITABLE_FIELDS = [
  'merchantLegalEntityReference',
  'merchantCategoryCode',
  'merchantName',
  'merchantCountryCode',
  'merchantAgreementKybCheckNotes', // maps into the BQ:Step notes
] as const;
export type KybEditableField = (typeof KYB_EDITABLE_FIELDS)[number];

async function getMerchantRaw(db: Db, id: string): Promise<MerchantAgreementControlRecord | null> {
  return db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ merchantAgreementInstanceReference: id } as never, { projection: { merchantWebhookSecret: 0 } });
}

export interface OwnerPartySummary {
  partyInstanceReference: string;
  partyName: string | null;
  partyType: string | null;
}

// Resolve non-sensitive party summaries (name + type) for a set of owner refs. GDPR minimization:
// only the display-safe identity fields are projected; postal address / other L2 PII is never read.
async function resolveOwnerSummaries(db: Db, refs: string[]): Promise<Record<string, OwnerPartySummary>> {
  if (refs.length === 0) return {};
  const rows = await db
    .collection<PartyControlRecord>(PARTY_COLLECTION)
    .find({ partyInstanceReference: { $in: refs } } as never, { projection: { partyInstanceReference: 1, partyName: 1, partyType: 1 } })
    .toArray();
  const out: Record<string, OwnerPartySummary> = {};
  for (const r of rows) {
    out[r.partyInstanceReference] = {
      partyInstanceReference: r.partyInstanceReference,
      partyName: typeof r.partyName === 'string' ? r.partyName : null,
      partyType: typeof r.partyType === 'string' ? r.partyType : null,
    };
  }
  return out;
}

export interface OwnerLayerRisk {
  anyPep: boolean;
  anySanctionsHit: boolean;
  maxRiskRating: 'low' | 'medium' | 'high' | null;
  // per-owner composed KYC verdict (by reference; no PII, no duplication)
  owners: Array<{ partyInstanceReference: string; kycStatus?: string; riskRating?: string; pepStatus?: boolean; sanctionsResult?: string }>;
}

const RISK_ORDER: Record<string, number> = { low: 1, medium: 2, high: 3 };

// Compose the OWNER-layer risk from each UBO's customerAgreementKycCheck (plan §3.5 owner layer).
// A controlling person failing PEP/sanctions raises the merchant's risk. No verdict duplicated.
async function composeOwnerLayerRisk(db: Db, owners: MerchantBeneficialOwner[]): Promise<OwnerLayerRisk> {
  const refs = owners.map((o) => o.merchantBeneficialOwnerPartyReference);
  const rows = refs.length
    ? await db
        .collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
        .find({ partyInstanceReference: { $in: refs } } as never, {
          projection: {
            partyInstanceReference: 1,
            'customerAgreementKycCheck.customerAgreementKycCheckStatus': 1,
            'customerAgreementKycCheck.customerAgreementKycCheckRiskRating': 1,
            'customerAgreementKycCheck.customerAgreementKycCheckPepStatus': 1,
            'customerAgreementKycCheck.customerAgreementKycCheckSanctionsResult': 1,
          },
        })
        .toArray()
    : [];
  const byRef = new Map(rows.map((r) => [r.partyInstanceReference, r.customerAgreementKycCheck]));
  let anyPep = false;
  let anySanctionsHit = false;
  let maxRisk: 'low' | 'medium' | 'high' | null = null;
  const perOwner = owners.map((o) => {
    const kc = byRef.get(o.merchantBeneficialOwnerPartyReference);
    const pep = kc?.customerAgreementKycCheckPepStatus === true;
    const sanctions = kc?.customerAgreementKycCheckSanctionsResult;
    const rr = kc?.customerAgreementKycCheckRiskRating;
    if (pep) anyPep = true;
    if (sanctions === 'hit') anySanctionsHit = true;
    if (rr && (!maxRisk || RISK_ORDER[rr] > RISK_ORDER[maxRisk])) maxRisk = rr;
    return {
      partyInstanceReference: o.merchantBeneficialOwnerPartyReference,
      kycStatus: kc?.customerAgreementKycCheckStatus,
      riskRating: rr,
      pepStatus: pep,
      sanctionsResult: sanctions,
    };
  });
  return { anyPep, anySanctionsHit, maxRiskRating: maxRisk, owners: perOwner };
}

export type KybDetailResult =
  | { status: 'not_found' }
  | {
      status: 'ok';
      merchant: MerchantAgreementControlRecord;
      owners: Array<MerchantBeneficialOwner & { party: OwnerPartySummary | null }>;
      ownerLayerRisk: OwnerLayerRisk;
    };

export async function getKybDetail(db: Db, id: string): Promise<KybDetailResult> {
  const merchant = await getMerchantRaw(db, id);
  if (!merchant) return { status: 'not_found' };
  const owners = merchant.merchantBeneficialOwners ?? [];
  const summaries = await resolveOwnerSummaries(db, owners.map((o) => o.merchantBeneficialOwnerPartyReference));
  const ownerLayerRisk = await composeOwnerLayerRisk(db, owners);
  return {
    status: 'ok',
    merchant,
    owners: owners.map((o) => ({ ...o, party: summaries[o.merchantBeneficialOwnerPartyReference] ?? null })),
    ownerLayerRisk,
  };
}

export type OwnersListResult =
  | { status: 'not_found' }
  | { status: 'ok'; owners: Array<MerchantBeneficialOwner & { party: OwnerPartySummary | null }>; primaryOwnerPartyReference?: string };

export async function listBeneficialOwners(db: Db, id: string): Promise<OwnersListResult> {
  const merchant = await getMerchantRaw(db, id);
  if (!merchant) return { status: 'not_found' };
  const owners = merchant.merchantBeneficialOwners ?? [];
  const summaries = await resolveOwnerSummaries(db, owners.map((o) => o.merchantBeneficialOwnerPartyReference));
  return {
    status: 'ok',
    owners: owners.map((o) => ({ ...o, party: summaries[o.merchantBeneficialOwnerPartyReference] ?? null })),
    primaryOwnerPartyReference: merchant.merchantOwnerPartyReference,
  };
}

export { isMerchantOwner };

interface AuditActor {
  performedByPartyReference?: string;
  performedByRole?: string;
}

// PATCH KYB data (correction). amendmentReason enforced by the controller. Rejects (nothing here) any
// status/verdict write. Emits kyb.record.amended with changed FIELD NAMES only (GDPR minimization).
export type KybPatchResult = { status: 'not_found' } | { status: 'invalid'; error: string } | { status: 'ok'; merchant: MerchantAgreementControlRecord };

export async function patchKybData(
  db: Db,
  id: string,
  patch: Record<string, unknown>,
  amendmentReason: string,
  actor: AuditActor,
): Promise<KybPatchResult> {
  const merchant = await getMerchantRaw(db, id);
  if (!merchant) return { status: 'not_found' };

  const set: Record<string, unknown> = {};
  const changedFields: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!KYB_EDITABLE_FIELDS.includes(k as KybEditableField)) {
      return { status: 'invalid', error: `Field '${k}' is not editable on the KYB administration surface.` };
    }
    if (k === 'merchantAgreementKybCheckNotes') {
      set['merchantAgreementKybCheck.merchantAgreementKybCheckNotes'] = v;
    } else {
      set[k] = v;
    }
    changedFields.push(k);
  }
  if (changedFields.length === 0) return { status: 'invalid', error: 'No editable fields supplied.' };

  set.recordUpdatedDateTime = new Date();
  const updated = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOneAndUpdate({ merchantAgreementInstanceReference: id } as never, { $set: set }, {
      returnDocument: 'after',
      projection: { merchantWebhookSecret: 0 },
    });
  if (!updated) return { status: 'not_found' };

  await appendMerchantEvent(db, id, 'kyb.record.amended', { performedByPartyReference: actor.performedByPartyReference, performedByRole: actor.performedByRole, details: { changedFields } });
  emitComplianceEvent(db, {
    entityType: 'merchant',
    entityId: id,
    processType: 'kyb_verification',
    processAction: 'kyb.record.amended',
    processOutcome: 'approved',
    performedByPartyReference: actor.performedByPartyReference ?? null,
    performedByRole: actor.performedByRole ?? null,
    eventSummary: { amendmentReason, changedFields },
    bianServiceDomain: 'Merchant Relations',
    bianControlRecordType: 'MerchantAgreementProcedure',
  });
  return { status: 'ok', merchant: updated };
}

// ── Beneficial-owner CRUD (bounded embed, ownership metadata only) ───────────────────────────────
export type OwnerMutationResult =
  | { status: 'not_found' }
  | { status: 'invalid'; error: string }
  | { status: 'conflict' }
  | { status: 'ok'; owners: MerchantBeneficialOwner[] };

export interface AddOwnerInput {
  merchantBeneficialOwnerPartyReference: string;
  merchantBeneficialOwnerRole: MerchantBeneficialOwnerRole;
  merchantBeneficialOwnerOwnershipPercentage: number;
  merchantBeneficialOwnerIsPrimary?: boolean;
  merchantBeneficialOwnerIsControllingPerson?: boolean;
}

// Atomic single-document write of the full owner array + derived primary pointer, guarded by
// recordUpdatedDateTime (optimistic concurrency) so a concurrent edit does not lose updates.
async function commitOwners(
  db: Db,
  merchant: MerchantAgreementControlRecord,
  owners: MerchantBeneficialOwner[],
): Promise<OwnerMutationResult> {
  const validation = validateBeneficialOwners(owners);
  if (!validation.ok) return { status: 'invalid', error: validation.error! };
  const primaryRef = derivePrimaryOwnerRef(owners);

  const res = await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
    { merchantAgreementInstanceReference: merchant.merchantAgreementInstanceReference, recordUpdatedDateTime: merchant.recordUpdatedDateTime } as never,
    { $set: { merchantBeneficialOwners: owners, merchantOwnerPartyReference: primaryRef, recordUpdatedDateTime: new Date() } },
  );
  if (res.matchedCount === 0) return { status: 'conflict' };
  return { status: 'ok', owners };
}

export async function addBeneficialOwner(db: Db, id: string, input: AddOwnerInput, actor: AuditActor): Promise<OwnerMutationResult> {
  const merchant = await getMerchantRaw(db, id);
  if (!merchant) return { status: 'not_found' };

  // Referenced party must exist : owners reference existing parties only, never invented here.
  const party = await db.collection<PartyControlRecord>(PARTY_COLLECTION).findOne({ partyInstanceReference: input.merchantBeneficialOwnerPartyReference } as never, { projection: { partyInstanceReference: 1 } });
  if (!party) return { status: 'invalid', error: 'Referenced party does not exist.' };

  const owners = [...(merchant.merchantBeneficialOwners ?? [])];
  if (owners.some((o) => o.merchantBeneficialOwnerPartyReference === input.merchantBeneficialOwnerPartyReference)) {
    return { status: 'invalid', error: 'That party is already a beneficial owner of this merchant.' };
  }
  const makePrimary = input.merchantBeneficialOwnerIsPrimary === true;
  if (makePrimary) owners.forEach((o) => (o.merchantBeneficialOwnerIsPrimary = false));

  const newOwner: MerchantBeneficialOwner = {
    merchantBeneficialOwnerPartyReference: input.merchantBeneficialOwnerPartyReference,
    merchantBeneficialOwnerRole: input.merchantBeneficialOwnerRole,
    merchantBeneficialOwnerOwnershipPercentage: input.merchantBeneficialOwnerOwnershipPercentage,
    merchantBeneficialOwnerIsPrimary: makePrimary || owners.length === 0,
    merchantBeneficialOwnerIsControllingPerson:
      input.merchantBeneficialOwnerIsControllingPerson ?? computeIsControllingPerson({ merchantBeneficialOwnerOwnershipPercentage: input.merchantBeneficialOwnerOwnershipPercentage, merchantBeneficialOwnerRole: input.merchantBeneficialOwnerRole }),
    merchantBeneficialOwnerAddedDateTime: new Date(),
    ...(actor.performedByPartyReference && { merchantBeneficialOwnerAddedByPartyReference: actor.performedByPartyReference }),
  };
  owners.push(newOwner);

  const result = await commitOwners(db, merchant, owners);
  if (result.status === 'ok') await emitOwnerEvent(db, id, 'kyb.owner.added', actor, { partyRef: input.merchantBeneficialOwnerPartyReference });
  return result;
}

export interface UpdateOwnerInput {
  merchantBeneficialOwnerRole?: MerchantBeneficialOwnerRole;
  merchantBeneficialOwnerOwnershipPercentage?: number;
  merchantBeneficialOwnerIsPrimary?: boolean;
  merchantBeneficialOwnerIsControllingPerson?: boolean;
}

export async function updateBeneficialOwner(db: Db, id: string, partyRef: string, input: UpdateOwnerInput, actor: AuditActor): Promise<OwnerMutationResult> {
  const merchant = await getMerchantRaw(db, id);
  if (!merchant) return { status: 'not_found' };
  const owners = (merchant.merchantBeneficialOwners ?? []).map((o) => ({ ...o }));
  const target = owners.find((o) => o.merchantBeneficialOwnerPartyReference === partyRef);
  if (!target) return { status: 'invalid', error: 'Owner not found on this merchant.' };

  let reassignedPrimary = false;
  if (input.merchantBeneficialOwnerRole !== undefined) target.merchantBeneficialOwnerRole = input.merchantBeneficialOwnerRole;
  if (input.merchantBeneficialOwnerOwnershipPercentage !== undefined) target.merchantBeneficialOwnerOwnershipPercentage = input.merchantBeneficialOwnerOwnershipPercentage;
  if (input.merchantBeneficialOwnerIsControllingPerson !== undefined) target.merchantBeneficialOwnerIsControllingPerson = input.merchantBeneficialOwnerIsControllingPerson;
  if (input.merchantBeneficialOwnerIsPrimary === true && !target.merchantBeneficialOwnerIsPrimary) {
    owners.forEach((o) => (o.merchantBeneficialOwnerIsPrimary = false));
    target.merchantBeneficialOwnerIsPrimary = true;
    reassignedPrimary = true;
  }

  const result = await commitOwners(db, merchant, owners);
  if (result.status === 'ok') {
    await emitOwnerEvent(db, id, 'kyb.owner.amended', actor, { partyRef, changedFields: Object.keys(input) });
    if (reassignedPrimary) await emitOwnerEvent(db, id, 'kyb.owner.primary.reassigned', actor, { partyRef });
  }
  return result;
}

export async function removeBeneficialOwner(db: Db, id: string, partyRef: string, actor: AuditActor): Promise<OwnerMutationResult> {
  const merchant = await getMerchantRaw(db, id);
  if (!merchant) return { status: 'not_found' };
  const owners = merchant.merchantBeneficialOwners ?? [];
  const target = owners.find((o) => o.merchantBeneficialOwnerPartyReference === partyRef);
  if (!target) return { status: 'invalid', error: 'Owner not found on this merchant.' };
  if (owners.length <= 1) return { status: 'invalid', error: 'Cannot remove the last beneficial owner.' };
  if (target.merchantBeneficialOwnerIsPrimary) return { status: 'invalid', error: 'Cannot remove the primary owner. Reassign the primary first.' };

  const remaining = owners.filter((o) => o.merchantBeneficialOwnerPartyReference !== partyRef);
  const result = await commitOwners(db, merchant, remaining);
  if (result.status === 'ok') await emitOwnerEvent(db, id, 'kyb.owner.removed', actor, { partyRef });
  return result;
}

async function emitOwnerEvent(db: Db, id: string, action: string, actor: AuditActor, summary: Record<string, unknown>): Promise<void> {
  await appendMerchantEvent(db, id, action, { performedByPartyReference: actor.performedByPartyReference, performedByRole: actor.performedByRole, details: summary });
  emitComplianceEvent(db, {
    entityType: 'merchant',
    entityId: id,
    processType: 'kyb_verification',
    processAction: action,
    processOutcome: 'approved',
    performedByPartyReference: actor.performedByPartyReference ?? null,
    performedByRole: actor.performedByRole ?? null,
    eventSummary: summary,
    bianServiceDomain: 'Merchant Relations',
    bianControlRecordType: 'MerchantAgreementProcedure',
  });
}

// ── Structured KYB verdict (entity layer, §3.5) ──────────────────────────────────────────────────
export interface KybScreeningVerdict {
  businessRiskLevel: 'low' | 'medium' | 'high';
  sanctionsResult: 'clear' | 'hit' | 'pending';
  adverseMediaResult: 'clear' | 'hit' | 'pending';
  screeningProviderRef: string;
}

// Mirrors applyKycScreeningVerdict: writes the structured verdict AND the BQ:Step status in ONE atomic
// single-document update (no drift). The shared deriveKybCheckStatus mapper governs the status, so the
// internal saga path and the external callback path yield identical results. Idempotent (deterministic).
export async function applyKybScreeningVerdict(
  db: Db,
  merchantAgreementInstanceReference: string,
  verdict: KybScreeningVerdict,
  mode: DecisionMode,
): Promise<boolean> {
  const status = deriveKybCheckStatus(
    { businessRiskLevel: verdict.businessRiskLevel, sanctionsResult: verdict.sanctionsResult, adverseMediaResult: verdict.adverseMediaResult },
    mode,
  );
  const now = new Date();
  const set: Partial<Record<string, unknown>> = {
    'merchantAgreementKybCheck.merchantAgreementKybCheckStatus': status,
    'merchantAgreementKybCheck.merchantAgreementKybCheckBusinessRiskLevel': verdict.businessRiskLevel,
    'merchantAgreementKybCheck.merchantAgreementKybCheckSanctionsResult': verdict.sanctionsResult,
    'merchantAgreementKybCheck.merchantAgreementKybCheckAdverseMediaResult': verdict.adverseMediaResult,
    'merchantAgreementKybCheck.merchantAgreementKybCheckScreeningProviderRef': verdict.screeningProviderRef,
    'merchantAgreementKybCheck.merchantAgreementKybCheckCompletedDate': now,
    recordUpdatedDateTime: now,
  };
  const res = await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
    { merchantAgreementInstanceReference } as never,
    { $set: set },
  );
  return res.matchedCount > 0;
}

export { effectiveDecisionMode };
export type { MerchantAgreementKybCheck };

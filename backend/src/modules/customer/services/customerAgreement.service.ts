import { Db } from 'mongodb';
import {
  CUSTOMER_AGREEMENT_COLLECTION,
  CustomerAgreementControlRecord,
  isSensitiveDecrypted,
} from '../models/customerAgreement.model';
import { PARTY_COLLECTION, PartyControlRecord } from '../../identity/models/party.model';
import { CUSTOMER_AUTHENTICATION_COLLECTION } from '../../identity/models/customerAuthentication.model';
import type { UserRole } from '../../../shared/models/identity.model';
import { getDbForRole } from '../../../vendors/encryption/roleClients';
import { phoneDigest } from '../../../vendors/encryption/digest';
import { canReadSensitive } from '../../../vendors/middleware/rbac';
import { validateToken } from '../../../vendors/security/escalationTokens';
import { appendAuditEvent } from '../../fraud/services/fraudDiagnosis.service';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';
import { deriveKycCheckStatus, DecisionMode } from '../../../shared/models/onboardingDecision';
import { config } from '../../../config';

/**
 * Build the API response from a unified customerAgreementProcedure document.
 *
 * With the Level 1 QE client, sensitive fields (address, govId, riskNotes) come back
 * as Binary ciphertext - isSensitiveDecrypted() returns false and they are omitted.
 * With the Level 2 QE client the driver has already auto-decrypted them.
 */
function buildResponse(
  doc: CustomerAgreementControlRecord,
  party: PartyControlRecord,
  role: UserRole,
  canSeeSensitive: boolean,
  caseId?: string,
): Record<string, unknown> {
  // Least-privilege (PCI DSS Req 7 need-to-know · BIAN SD-53/SD-13): contact PII (email,
  // phone) is QE:equality — searchable while encrypted — but is exposed in responses only to
  // roles with an operational need to contact/verify the customer (L2 investigator, auditor).
  // L1 triages on non-identifying attributes (name, segment, status, KYC outcome) and never
  // receives the contact PII. Deeper QE:none PII (address, gov ID, risk notes) stays gated by
  // escalation below. Redaction is enforced server-side; the client is never trusted.
  const canSeeContactPii = role === 'level2_investigator' || role === 'security_auditor';

  const base: Record<string, unknown> = {
    customerAgreementInstanceReference: doc.customerAgreementInstanceReference,
    partyInstanceReference:             doc.partyInstanceReference,
    customerName:                       party.partyName,
    customerEmailAddress:               canSeeContactPii ? party.partyEmailAddress : undefined,
    customerMobilePhoneNumber:          canSeeContactPii ? party.partyMobilePhoneNumber : undefined,
    customerAgreementReference:         doc.customerAgreementReference,
    customerSegment:                    doc.customerSegment,
    customerAgreementStatus:            doc.customerAgreementStatus,
    customerAgreementEnrollmentDate:    doc.customerAgreementEnrollmentDate,
    customerAgreementPreferredLanguage: doc.customerAgreementPreferredLanguage,
    customerAgreementKycCheck:          doc.customerAgreementKycCheck ?? null,
    contactPiiRestricted:               !canSeeContactPii,
    bianServiceDomain:                  doc.bianServiceDomain,
    bianControlRecordType:              doc.bianControlRecordType,
  };

  // Sensitive QE:none PII is attached ONLY when the role is explicitly authorized
  // (auditor, or L2 with a valid escalation token) — never merely because the bytes came
  // back decrypted. This is fail-closed: if the demo DB stores these fields in plaintext
  // (QE not active), an unauthorized role still does NOT receive them. PCI DSS Req 7.
  if (canSeeSensitive && isSensitiveDecrypted(doc.customerAgreementResidentialAddress)) {
    base.sensitive = {
      customerAgreementResidentialAddress: doc.customerAgreementResidentialAddress,
      governmentIdentificationReference:   doc.governmentIdentificationReference,
      customerAgreementRiskNotes:          doc.customerAgreementRiskNotes,
    };
  }

  return base;
}

// -- Internal helpers --------------------------------------------------------─

async function resolveDb(role: UserRole, escalationToken: string | undefined): Promise<{ db: Db; hasValidToken: boolean; caseId?: string }> {
  const tokenResult = validateToken(escalationToken);
  const hasValidToken = tokenResult.valid;
  const db = await getDbForRole(role, hasValidToken);
  return { db, hasValidToken, caseId: tokenResult.entry?.caseId };
}

async function findPartyAndAgreement(
  db: Db,
  partyQuery: Partial<PartyControlRecord>
): Promise<{ doc: CustomerAgreementControlRecord; party: PartyControlRecord } | null> {
  const party = await db.collection<PartyControlRecord>(PARTY_COLLECTION).findOne(partyQuery);
  if (!party) return null;
  const doc = await db.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ partyInstanceReference: party.partyInstanceReference });
  if (!doc) return null;
  return { doc, party };
}

async function maybeAudit(db: Db, caseId: string | undefined, role: UserRole, doc: CustomerAgreementControlRecord, canSeeSensitive: boolean, actor?: { ref?: string; name?: string }): Promise<void> {
  if (!caseId) return;
  if (!canSeeSensitive) return; // only an actual sensitive disclosure is audited (Req 10)
  if (!isSensitiveDecrypted(doc.customerAgreementResidentialAddress)) return;
  await appendAuditEvent(db, caseId, 'field_accessed', role as 'level2_investigator' | 'security_auditor', {
    fields: ['customerAgreementResidentialAddress', 'governmentIdentificationReference', 'customerAgreementRiskNotes'],
    customerAgreementInstanceReference: doc.customerAgreementInstanceReference,
  }, actor);
}

// -- Public query functions --------------------------------------------------─

export async function getByEmail(db: Db, email: string, role: UserRole = 'level1_analyst', escalationToken?: string, actor?: { ref?: string; name?: string }) {
  const { db: roleDb, hasValidToken, caseId } = await resolveDb(role, escalationToken);
  const canSee = canReadSensitive(role, hasValidToken);
  const result = await findPartyAndAgreement(roleDb, { partyEmailAddress: email } as Partial<PartyControlRecord>);
  if (!result) return null;
  await maybeAudit(roleDb, caseId, role, result.doc, canSee, actor);
  return buildResponse(result.doc, result.party, role, canSee, caseId);
}

export async function getByPhone(db: Db, phone: string, role: UserRole = 'level1_analyst', escalationToken?: string, actor?: { ref?: string; name?: string }) {
  const { db: roleDb, hasValidToken, caseId } = await resolveDb(role, escalationToken);
  const canSee = canReadSensitive(role, hasValidToken);
  const result = await findPartyAndAgreement(roleDb, { partyMobilePhoneNumber: phone } as Partial<PartyControlRecord>);
  if (!result) return null;
  await maybeAudit(roleDb, caseId, role, result.doc, canSee, actor);
  return buildResponse(result.doc, result.party, role, canSee, caseId);
}

export async function getByAccountRef(db: Db, ref: string, role: UserRole = 'level1_analyst', escalationToken?: string, actor?: { ref?: string; name?: string }) {
  const { db: roleDb, hasValidToken, caseId } = await resolveDb(role, escalationToken);
  const canSee = canReadSensitive(role, hasValidToken);
  const doc = await roleDb.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerAgreementReference: ref } as Partial<CustomerAgreementControlRecord>);
  if (!doc) return null;
  const party = await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION)
    .findOne({ partyInstanceReference: doc.partyInstanceReference });
  if (!party) return null;
  await maybeAudit(roleDb, caseId, role, doc, canSee, actor);
  return buildResponse(doc, party, role, canSee, caseId);
}

export async function getByInstanceReference(db: Db, id: string, role: UserRole = 'level1_analyst', escalationToken?: string, actor?: { ref?: string; name?: string }) {
  const { db: roleDb, hasValidToken, caseId } = await resolveDb(role, escalationToken);
  const canSee = canReadSensitive(role, hasValidToken);
  const doc = await roleDb.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerAgreementInstanceReference: id });
  if (!doc) return null;
  const party = await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION)
    .findOne({ partyInstanceReference: doc.partyInstanceReference });
  if (!party) return null;
  await maybeAudit(roleDb, caseId, role, doc, canSee, actor);
  return buildResponse(doc, party, role, canSee, caseId);
}

// ── v31 KYC Administration (customer module) ─────────────────────────────────────────────────────
// KYC detail keyed on partyInstanceReference (the party is the single owner of a KYC record). L1/L2
// masking respected exactly like the lookup functions (viewSensitive + escalation token → L2 decrypt).
export async function getKycByPartyRef(db: Db, partyRef: string, role: UserRole = 'level1_analyst', escalationToken?: string, actor?: { ref?: string; name?: string }) {
  const { db: roleDb, hasValidToken, caseId } = await resolveDb(role, escalationToken);
  const canSee = canReadSensitive(role, hasValidToken);
  const result = await findPartyAndAgreement(roleDb, { partyInstanceReference: partyRef } as Partial<PartyControlRecord>);
  if (!result) return null;
  await maybeAudit(roleDb, caseId, role, result.doc, canSee, actor);
  const { doc, party } = result;

  // KYC-administration detail (v31). Surfaces the full person profile with per-field encryption tiers so
  // the UI can badge each field and offer an audited on-demand reveal for the QE:none fields. Tiering:
  //  - QE:equality / range / prefix / suffix (searchable) are in the L1 map → auto-decrypted at L1 and
  //    shown directly (identity + documents are the KYC admin's need-to-know: name, DOB, nationality,
  //    place of birth, sex, occupation, tax ID, and the government ID leaves). Encrypted AT REST; the
  //    driver decrypts in-process, Atlas never sees plaintext.
  //  - QE:none (residential address, source of funds, purpose, risk notes, party postal address) are
  //    L2-only: returned here ONLY when the caller already decrypted them (auditor / L2 with token);
  //    otherwise null + sensitiveMasked=true. The UI offers the audited reveal endpoint for them.
  const dec = (v: unknown): unknown => (isSensitiveDecrypted(v) ? v : null);
  return {
    partyInstanceReference: doc.partyInstanceReference,
    customerAgreementInstanceReference: doc.customerAgreementInstanceReference,
    customerName: party.partyName,
    partyType: party.partyType,
    // Identity (QE searchable → L1-visible; encrypted at rest).
    partyDateOfBirth: party.partyDateOfBirth ?? null,
    partyNationality: party.partyNationality ?? null,
    partyPlaceOfBirth: party.partyPlaceOfBirth ?? null,
    partySex: party.partySex ?? null,
    customerSegment: doc.customerSegment,
    customerAgreementStatus: doc.customerAgreementStatus,
    customerAgreementReference: doc.customerAgreementReference,
    customerAgreementEnrollmentDate: doc.customerAgreementEnrollmentDate,
    customerAgreementPreferredLanguage: doc.customerAgreementPreferredLanguage,
    customerAgreementKycCheck: doc.customerAgreementKycCheck ?? null,
    // Documents + KYC data. occupation/taxID/govID are QE searchable → visible at L1 (identity docs).
    customerAgreementOccupation: isSensitiveDecrypted(doc.customerAgreementOccupation) ? doc.customerAgreementOccupation : null,
    customerAgreementTaxIDNumber: isSensitiveDecrypted(doc.customerAgreementTaxIDNumber) ? doc.customerAgreementTaxIDNumber : null,
    customerAgreementGovernmentID: dec(doc.customerAgreementGovernmentID),
    // QE:none (L2-only) — null unless the caller decrypted them; offered via the audited reveal endpoint.
    customerAgreementSourceOfFunds: dec(doc.customerAgreementSourceOfFunds),
    customerAgreementPurposeOfRelationship: dec(doc.customerAgreementPurposeOfRelationship),
    customerAgreementResidentialAddress: dec(doc.customerAgreementResidentialAddress),
    sensitiveMasked: !canSee,
  };
}

// v31: audited on-demand reveal of the QE:none (L2-only) KYC fields for the administration workbench.
// Mirrors the operations_officer PAN/IBAN reveal pattern (ephemeral, on demand, audited — PCI Req 3.2/3.3
// for CHD-adjacent identity data, GDPR need-to-know, Req 10). Reads via the L2 QE client so the QE:none
// fields decrypt, records a field-access compliance event (field NAMES only, no values), and returns the
// plaintext to the caller for display only (never persisted). Gated by customers:manage at the route.
export async function revealKycSensitive(
  db: Db,
  partyRef: string,
  actor: { performedByPartyReference?: string; performedByRole?: string },
): Promise<{ status: 'not_found' } | { status: 'ok'; fields: Record<string, unknown> }> {
  const roleDb = await getDbForRole('security_auditor', false); // L2 QE client (decrypts QE:none)
  const doc = await roleDb.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ partyInstanceReference: partyRef });
  if (!doc) return { status: 'not_found' };
  const party = await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION)
    .findOne({ partyInstanceReference: partyRef });

  const fields = {
    customerAgreementResidentialAddress: doc.customerAgreementResidentialAddress ?? null,
    customerAgreementSourceOfFunds: doc.customerAgreementSourceOfFunds ?? null,
    customerAgreementPurposeOfRelationship: doc.customerAgreementPurposeOfRelationship ?? null,
    customerAgreementRiskNotes: doc.customerAgreementRiskNotes ?? null,
    partyPostalAddress: party?.partyPostalAddress ?? null,
  };

  emitComplianceEvent(db, {
    entityType: 'customer',
    entityId: partyRef,
    processType: 'kyc_verification',
    processAction: 'kyc.sensitive.revealed',
    processOutcome: 'approved',
    performedByPartyReference: actor.performedByPartyReference ?? null,
    performedByRole: actor.performedByRole ?? null,
    // GDPR minimization / PCI Req 10: log which fields were revealed, never their values.
    eventSummary: { revealedFields: Object.keys(fields) },
    bianServiceDomain: 'Customer Agreement',
    bianControlRecordType: 'CustomerAgreementProcedure',
  });

  return { status: 'ok', fields };
}

const KYC_COMPLETED_STATUSES = ['verified', 'rejected', 'expired'];

// Paged list of parties that COMPLETED KYC. L1 (masked) by default — QE:none sensitive leaves come back
// as ciphertext and are never projected here. Index-backed: the ESR compound
// { kycCheckStatus, customerSegment, recordUpdatedDateTime } serves the filter + sort (no COLLSCAN).
export async function listKycAdmin(
  role: UserRole,
  filters: { status?: string; segment?: string; riskRating?: string; partyType?: string; page?: number; limit?: number },
) {
  const roleDb = await getDbForRole(role, false); // L1 masked for the list
  const query: Record<string, unknown> = {
    'customerAgreementKycCheck.customerAgreementKycCheckStatus': filters.status && KYC_COMPLETED_STATUSES.includes(filters.status)
      ? filters.status
      : { $in: KYC_COMPLETED_STATUSES },
  };
  if (filters.segment) query.customerSegment = filters.segment;
  // riskRating is QE:equality — queryable on the QE client via a plain equality predicate.
  if (filters.riskRating) query['customerAgreementKycCheck.customerAgreementKycCheckRiskRating'] = filters.riskRating;

  // v31: scope to a party TYPE (default 'customer' from the UI). partyType lives on the `party` record,
  // so resolve the matching party refs first and constrain the agreement query by them (bounded set).
  // `all` (or unset) applies no type constraint.
  if (filters.partyType && filters.partyType !== 'all') {
    const typedParties = await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION)
      .find({ partyType: filters.partyType } as never, { projection: { partyInstanceReference: 1 } })
      .toArray();
    query.partyInstanceReference = { $in: typedParties.map((p) => p.partyInstanceReference) };
  }

  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const skip = (page - 1) * limit;

  const col = roleDb.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION);
  const [docs, total] = await Promise.all([
    col.find(query).sort({ recordUpdatedDateTime: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(query),
  ]);

  const partyRefs = docs.map((d) => d.partyInstanceReference);
  const parties = partyRefs.length
    ? await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION)
        .find({ partyInstanceReference: { $in: partyRefs } } as never, { projection: { partyInstanceReference: 1, partyName: 1 } })
        .toArray()
    : [];
  const nameByRef = new Map(parties.map((p) => [p.partyInstanceReference, typeof p.partyName === 'string' ? p.partyName : null]));

  const results = docs.map((d) => ({
    partyInstanceReference: d.partyInstanceReference,
    partyName: nameByRef.get(d.partyInstanceReference) ?? null,
    customerAgreementInstanceReference: d.customerAgreementInstanceReference,
    customerSegment: d.customerSegment,
    customerAgreementStatus: d.customerAgreementStatus,
    customerAgreementKycCheckStatus: d.customerAgreementKycCheck?.customerAgreementKycCheckStatus,
    customerAgreementKycCheckRiskRating: d.customerAgreementKycCheck?.customerAgreementKycCheckRiskRating,
    customerAgreementKycCheckPepStatus: d.customerAgreementKycCheck?.customerAgreementKycCheckPepStatus,
    customerAgreementKycCheckSanctionsResult: d.customerAgreementKycCheck?.customerAgreementKycCheckSanctionsResult,
    recordUpdatedDateTime: d.recordUpdatedDateTime,
  }));
  return { results, total, page, limit };
}

// KYC data fields the Administration surface may correct (plan §4.2). NEVER the KYC check status/verdict.
const KYC_EDITABLE_FIELDS = new Set([
  'customerAgreementOccupation',
  'customerAgreementSourceOfFunds',
  'customerAgreementPurposeOfRelationship',
  'customerAgreementGovernmentID',
  'customerAgreementResidentialAddress',
]);

export type KycPatchResult = { status: 'not_found' } | { status: 'invalid'; error: string } | { status: 'ok' };

// Correct KYC data. Writes through the L2 QE client so QE leaves encrypt on write. Rejects any write to
// customerAgreementKycCheckStatus (verdict is not editable here — decision 2). Emits kyc.record.amended
// with changed FIELD NAMES only (no before/after PII in the ledger, GDPR minimization).
export async function patchKycData(
  db: Db,
  partyRef: string,
  patch: Record<string, unknown>,
  amendmentReason: string,
  actor: { performedByPartyReference?: string; performedByRole?: string },
): Promise<KycPatchResult> {
  const set: Record<string, unknown> = {};
  const changedFields: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!KYC_EDITABLE_FIELDS.has(k)) return { status: 'invalid', error: `Field '${k}' is not editable on the KYC administration surface.` };
    set[k] = v;
    changedFields.push(k);
  }
  if (changedFields.length === 0) return { status: 'invalid', error: 'No editable fields supplied.' };
  set.recordUpdatedDateTime = new Date();

  const roleDb = await getDbForRole('security_auditor', false); // L2 QE client (encrypt on write)
  const res = await roleDb.collection(CUSTOMER_AGREEMENT_COLLECTION).updateOne({ partyInstanceReference: partyRef }, { $set: set });
  if (res.matchedCount === 0) return { status: 'not_found' };

  emitComplianceEvent(db, {
    entityType: 'customer',
    entityId: partyRef,
    processType: 'kyc_verification',
    processAction: 'kyc.record.amended',
    processOutcome: 'approved',
    performedByPartyReference: actor.performedByPartyReference ?? null,
    performedByRole: actor.performedByRole ?? null,
    eventSummary: { amendmentReason, changedFields },
    bianServiceDomain: 'Customer Agreement',
    bianControlRecordType: 'CustomerAgreementProcedure',
  });
  return { status: 'ok' };
}

export async function getSelfProfile(db: Db, email: string): Promise<Record<string, unknown> | null> {
  // Self-profile always uses L2 db so the customer can see their own address
  const roleDb = await getDbForRole('security_auditor', false);
  const result = await findPartyAndAgreement(roleDb, { partyEmailAddress: email } as Partial<PartyControlRecord>);
  if (!result) return null;
  const { doc, party } = result;
  return {
    customerAgreementInstanceReference: doc.customerAgreementInstanceReference,
    partyInstanceReference:             doc.partyInstanceReference,
    customerName:                       party.partyName,
    customerEmailAddress:               party.partyEmailAddress,
    customerMobilePhoneNumber:          party.partyMobilePhoneNumber,
    customerAgreementReference:         doc.customerAgreementReference,
    customerSegment:                    doc.customerSegment,
    customerAgreementStatus:            doc.customerAgreementStatus,
    customerAgreementEnrollmentDate:    doc.customerAgreementEnrollmentDate,
    customerAgreementPreferredLanguage: doc.customerAgreementPreferredLanguage,
    customerAgreementKycCheck:          doc.customerAgreementKycCheck ?? null,
    // v27 KYC identity (SD-53). Self-profile runs on the L2/auditor client, so the QE-encrypted
    // scalar leaves (govId .number QE:suffix, .type/.issuingCountry QE:equality, .expiryDate
    // QE:range; taxId QE:prefix; occupation QE:equality) are decrypted for the owner.
    customerAgreementGovernmentID:      doc.customerAgreementGovernmentID ?? null,
    customerAgreementTaxIDNumber:       doc.customerAgreementTaxIDNumber,
    customerAgreementOccupation:        doc.customerAgreementOccupation,
    // SD-13 party demographics, decrypted here for the owner (QE:range DOB, QE:equality rest).
    partyDateOfBirth:                   party.partyDateOfBirth,
    partyNationality:                   party.partyNationality,
    partyPlaceOfBirth:                  party.partyPlaceOfBirth,
    partySex:                           party.partySex,
    sensitive: isSensitiveDecrypted(doc.customerAgreementResidentialAddress) ? {
      customerAgreementResidentialAddress:    doc.customerAgreementResidentialAddress,
      governmentIdentificationReference:      doc.governmentIdentificationReference,
      customerAgreementSourceOfFunds:         doc.customerAgreementSourceOfFunds,
      customerAgreementPurposeOfRelationship: doc.customerAgreementPurposeOfRelationship,
    } : null,
  };
}

export async function updateSelfProfile(
  db: Db,
  email: string,
  patch: {
    customerName?: string;
    customerAgreementPreferredLanguage?: string;
    customerAgreementResidentialAddress?: { streetAddress: string; city: string; postalCode: string; countryCode: string };
    customerMobilePhoneNumber?: string;
  }
): Promise<boolean> {
  // Write operations always use L2 db so QE:none fields are encrypted on write
  const roleDb = await getDbForRole('security_auditor', false);
  const party = await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION)
    .findOne({ partyEmailAddress: email } as Partial<PartyControlRecord>);
  if (!party) return false;

  let matched = false;

  // PII fields that live in party (SD-13)
  const partyPatch: Record<string, unknown> = {};
  if (patch.customerMobilePhoneNumber) {
    partyPatch.partyMobilePhoneNumber = patch.customerMobilePhoneNumber;
    // Keep the uniqueness blind index in sync. Reject up-front if another party already
    // owns this phone (the unique index is the hard guarantee; this gives a clean 409).
    const digest = phoneDigest(patch.customerMobilePhoneNumber);
    partyPatch.partyMobilePhoneNumberDigest = digest;
    const clash = await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION).findOne(
      { partyMobilePhoneNumberDigest: digest, partyInstanceReference: { $ne: party.partyInstanceReference } },
      { projection: { partyInstanceReference: 1 } }
    );
    if (clash) {
      throw Object.assign(new Error('Phone number already in use by another party'), { statusCode: 409 });
    }
  }
  if (patch.customerName) partyPatch.partyName = patch.customerName;

  if (Object.keys(partyPatch).length > 0) {
    partyPatch.recordUpdatedDateTime = new Date();
    try {
      await roleDb.collection(PARTY_COLLECTION).updateOne(
        { partyInstanceReference: party.partyInstanceReference },
        { $set: partyPatch }
      );
    } catch (e: any) {
      // Concurrent writer won the race for this phone — unique index rejected it.
      if (e?.code === 11000 || e?.code === 11001) {
        throw Object.assign(new Error('Phone number already in use by another party'), { statusCode: 409 });
      }
      throw e;
    }
    matched = true;

    // Sync Extended Reference: customerAuthenticationAssessment.customerAuthenticationUserName
    // mirrors party.partyName for JWT name claims. Update on every name change so the
    // source record stays accurate (JWT itself refreshes on next login).
    if (patch.customerName) {
      await roleDb.collection(CUSTOMER_AUTHENTICATION_COLLECTION).updateOne(
        { partyInstanceReference: party.partyInstanceReference },
        { $set: { customerAuthenticationUserName: patch.customerName } }
      );
    }
  }

  const agreementPatch: Record<string, unknown> = {};
  if (patch.customerAgreementPreferredLanguage) {
    agreementPatch.customerAgreementPreferredLanguage = patch.customerAgreementPreferredLanguage;
  }
  if (patch.customerAgreementResidentialAddress) {
    agreementPatch.customerAgreementResidentialAddress = patch.customerAgreementResidentialAddress;
  }
  if (Object.keys(agreementPatch).length > 0) {
    agreementPatch.recordUpdatedDateTime = new Date();
    const res = await roleDb.collection(CUSTOMER_AGREEMENT_COLLECTION).updateOne(
      { partyInstanceReference: party.partyInstanceReference },
      { $set: agreementPatch }
    );
    if (res.matchedCount > 0) matched = true;
  }

  if (matched) {
    void dispatchProvider(db, 'kyc_identity', 'kyc.validation.requested', {
      partyInstanceReference: party.partyInstanceReference,
      fieldsUpdated: Object.keys({ ...partyPatch, ...agreementPatch }).filter(k => k !== 'recordUpdatedDateTime'),
    }, { entityType: 'customer', entityId: party.partyInstanceReference, processType: 'kyc_verification' })
      .catch(() => { /* fire-and-forget */ });

    emitComplianceEvent(db, {
      entityType: 'customer',
      entityId: party.partyInstanceReference,
      processType: 'kyc_verification',
      processAction: 'profile.validation.completed',
      processOutcome: 'approved',
      performedByPartyReference: party.partyInstanceReference,
      performedByRole: 'customer',
      eventSummary: { fieldsUpdated: Object.keys({ ...partyPatch, ...agreementPatch }).filter(k => k !== 'recordUpdatedDateTime') },
      bianServiceDomain: 'Party Authentication',
      bianControlRecordType: 'PartyAuthenticationAssessment',
    });
  }

  return matched;
}

// -- v27: Queryable Encryption search showcase -------------------------------─
// Investigators/auditors search encrypted KYC fields (name, gov ID, TIN, DOB, verdicts)
// directly over ciphertext. The server encrypts the search value locally; Atlas never sees
// plaintext. API-first: this service is the single source of truth for which field maps to
// which QE query type, the validation rules, the role gate and the tier gate. The frontend
// renders only what the field registry exposes and enforces nothing the server does not.
//
// ROLE GATE (least-privilege, PCI DSS Req 7): this is a discovery capability that returns
// LISTS of customers, so it is restricted to investigator and auditor roles. Level 1 analysts
// keep only the blind single-record lookup (getByEmail/Phone/AccountRef); they must not be able
// to enumerate the customer base by attribute. The gate is enforced here (server-side), not in
// the client.
export const KYC_SEARCH_ROLES: ReadonlySet<UserRole> = new Set(['level2_investigator', 'security_auditor']);
export function canRunKycSearch(role: UserRole): boolean {
  return KYC_SEARCH_ROLES.has(role);
}

export type KycSearchMode = 'substring' | 'prefix' | 'suffix' | 'range' | 'equality';

export interface KycSearchFieldDef {
  key: string;
  label: string;
  collection: 'party' | 'agreement';
  path: string;
  baseMode: KycSearchMode;      // intended mode (text modes degrade to equality when gated)
  bsonType: 'string' | 'date' | 'int' | 'bool';
  minQueryLength?: number;
  maxQueryLength?: number;
  rangeMin?: number | string;   // ISO date string or int
  rangeMax?: number | string;
  enumValues?: Array<string | boolean>;
}

// QE text-search preview aggregation operators (MongoDB 8.2 / mongodb-client-encryption 7.2).
// If a spike shows different identifiers, change ONLY these three constants.
const ENC_CONTAINS = '$encStrContains';
const ENC_STARTS = '$encStrStartsWith';
const ENC_ENDS = '$encStrEndsWith';

// All searchable fields are QE lookup-tier (L1+ can decrypt + search). QE:none sensitive fields
// (address, sourceOfFunds, purpose, screeningRef) are never searchable, so they are not listed.
const KYC_SEARCH_FIELDS: KycSearchFieldDef[] = [
  // Contact / account keys (QE:equality) — the same fields as the L1 blind lookup, exposed here so
  // L2/auditor can do everything the simple lookup does from the one advanced surface (exact match).
  { key: 'email',                label: 'Email',             collection: 'party',     path: 'partyEmailAddress',      baseMode: 'equality', bsonType: 'string' },
  { key: 'phone',                label: 'Phone',             collection: 'party',     path: 'partyMobilePhoneNumber', baseMode: 'equality', bsonType: 'string' },
  { key: 'accountRef',           label: 'Account reference', collection: 'agreement', path: 'customerAgreementReference', baseMode: 'equality', bsonType: 'string' },
  { key: 'partyName',            label: 'Name',              collection: 'party',     path: 'partyName',            baseMode: 'substring', bsonType: 'string', minQueryLength: 3, maxQueryLength: 10 },
  { key: 'partyDateOfBirth',     label: 'Date of birth',     collection: 'party',     path: 'partyDateOfBirth',     baseMode: 'range',     bsonType: 'date',   rangeMin: '1900-01-01', rangeMax: '2020-01-01' },
  { key: 'partyNationality',     label: 'Nationality',       collection: 'party',     path: 'partyNationality',     baseMode: 'equality',  bsonType: 'string', enumValues: ['ES','GB','US','FR','DE','IT','PT','PL','MX','NG'] },
  { key: 'partyPlaceOfBirth',    label: 'Place of birth',    collection: 'party',     path: 'partyPlaceOfBirth',    baseMode: 'equality',  bsonType: 'string' },
  { key: 'govIdNumber',          label: 'Government ID no.', collection: 'agreement', path: 'customerAgreementGovernmentID.number',         baseMode: 'suffix',   bsonType: 'string', minQueryLength: 3, maxQueryLength: 10 },
  { key: 'govIdType',            label: 'Government ID type',collection: 'agreement', path: 'customerAgreementGovernmentID.type',           baseMode: 'equality', bsonType: 'string', enumValues: ['passport','national_id','driver_license'] },
  { key: 'govIdIssuingCountry',  label: 'Issuing country',   collection: 'agreement', path: 'customerAgreementGovernmentID.issuingCountry', baseMode: 'equality', bsonType: 'string', enumValues: ['ES','GB','US','FR','DE','IT','PT','PL','MX','NG'] },
  { key: 'govIdExpiry',          label: 'ID expiry date',    collection: 'agreement', path: 'customerAgreementGovernmentID.expiryDate',     baseMode: 'range',    bsonType: 'date',   rangeMin: '2000-01-01', rangeMax: '2040-01-01' },
  { key: 'taxId',                label: 'Tax ID (TIN)',      collection: 'agreement', path: 'customerAgreementTaxIDNumber',                 baseMode: 'prefix',   bsonType: 'string', minQueryLength: 2, maxQueryLength: 10 },
  { key: 'occupation',           label: 'Occupation',        collection: 'agreement', path: 'customerAgreementOccupation',                  baseMode: 'equality', bsonType: 'string' },
  { key: 'riskScore',            label: 'Risk score',        collection: 'agreement', path: 'customerAgreementKycCheck.customerAgreementKycCheckRiskScore',      baseMode: 'range',    bsonType: 'int',  rangeMin: 0, rangeMax: 100 },
  { key: 'riskRating',           label: 'Risk rating',       collection: 'agreement', path: 'customerAgreementKycCheck.customerAgreementKycCheckRiskRating',     baseMode: 'equality', bsonType: 'string', enumValues: ['low','medium','high'] },
  { key: 'pepStatus',            label: 'PEP status',        collection: 'agreement', path: 'customerAgreementKycCheck.customerAgreementKycCheckPepStatus',      baseMode: 'equality', bsonType: 'bool', enumValues: [true, false] },
  { key: 'sanctionsResult',      label: 'Sanctions result',  collection: 'agreement', path: 'customerAgreementKycCheck.customerAgreementKycCheckSanctionsResult',baseMode: 'equality', bsonType: 'string', enumValues: ['clear','hit','pending'] },
];

/** Effective mode: text modes degrade to equality on pre-8.2 clusters (PSP_QE_TEXT_SEARCH=false). */
function effectiveMode(def: KycSearchFieldDef): KycSearchMode {
  if (!config.qe.textSearch && (def.baseMode === 'substring' || def.baseMode === 'prefix' || def.baseMode === 'suffix')) {
    return 'equality';
  }
  return def.baseMode;
}

/** Field registry for the frontend. Reflects the active text-search gating and the L2-only result fields. */
export function getKycSearchRegistry() {
  return {
    textSearchEnabled: config.qe.textSearch,
    fields: KYC_SEARCH_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      mode: effectiveMode(f),
      baseMode: f.baseMode,      // intended mode (before pre-8.2 degradation), for the debug detail
      collection: f.collection,  // logical owner: party | agreement
      path: f.path,              // dotted document path of the encrypted field
      bsonType: f.bsonType,
      minQueryLength: f.minQueryLength,
      maxQueryLength: f.maxQueryLength,
      rangeMin: f.rangeMin,
      rangeMax: f.rangeMax,
      enumValues: f.enumValues,
    })),
    // QE:none fields: returnable only to L2 investigator / auditor, never searchable.
    sensitiveResultFields: [
      'customerAgreementResidentialAddress',
      'governmentIdentificationReference',
      'customerAgreementRiskNotes',
      'customerAgreementSourceOfFunds',
      'customerAgreementPurposeOfRelationship',
    ],
  };
}

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

export interface KycSearchRequest {
  field: string;
  value?: string;                  // equality / text
  from?: string;                   // range lower (ISO date or number)
  to?: string;                     // range upper
}

/**
 * Build the per-field MongoDB filter for a validated request. Text modes use QE preview
 * aggregation operators via $expr; range/equality use plain filters that the QE driver rewrites.
 */
function buildKycFilter(def: KycSearchFieldDef, mode: KycSearchMode, req: KycSearchRequest): Record<string, unknown> {
  if (mode === 'substring' || mode === 'prefix' || mode === 'suffix') {
    const v = (req.value ?? '').trim();
    const min = def.minQueryLength ?? 3;
    if (v.length < min) badRequest(`Query must be at least ${min} characters for ${def.key}`);
    if (def.maxQueryLength && v.length > def.maxQueryLength) badRequest(`Query exceeds ${def.maxQueryLength} characters for ${def.key}`);
    const input = `$${def.path}`;
    if (mode === 'substring') return { $expr: { [ENC_CONTAINS]: { input, substring: v } } };
    if (mode === 'prefix')    return { $expr: { [ENC_STARTS]:   { input, prefix: v } } };
    return { $expr: { [ENC_ENDS]: { input, suffix: v } } };
  }

  if (mode === 'range') {
    const cond: Record<string, unknown> = {};
    const coerce = (s: string): Date | number => def.bsonType === 'date' ? new Date(s) : Number(s);
    if (req.from == null && req.to == null) badRequest(`Range search on ${def.key} needs from and/or to`);
    if (req.from != null) {
      const lo = coerce(req.from);
      if (def.bsonType === 'date' ? isNaN((lo as Date).getTime()) : isNaN(lo as number)) badRequest(`Invalid from value for ${def.key}`);
      cond.$gte = lo;
    }
    if (req.to != null) {
      const hi = coerce(req.to);
      if (def.bsonType === 'date' ? isNaN((hi as Date).getTime()) : isNaN(hi as number)) badRequest(`Invalid to value for ${def.key}`);
      cond.$lte = hi;
    }
    return { [def.path]: cond };
  }

  // equality
  const raw = req.value;
  if (raw == null || raw === '') badRequest(`Value required for ${def.key}`);
  let value: string | number | boolean = raw;
  if (def.bsonType === 'bool') value = raw === 'true';
  else if (def.bsonType === 'int') { value = Number(raw); if (isNaN(value)) badRequest(`Invalid number for ${def.key}`); }
  if (def.enumValues && !def.enumValues.includes(value as string | boolean)) badRequest(`Value not allowed for ${def.key}`);
  return { [def.path]: value };
}

/**
 * Execute a QE search over an encrypted KYC field and return the tier-shaped agreement rows.
 * Reuses the role-aware QE client, the standard response shaping and the sensitive-access audit.
 */
export async function searchKyc(
  req: KycSearchRequest,
  role: UserRole = 'level1_analyst',
  escalationToken?: string,
  actor?: { ref?: string; name?: string },
  limit = 50,
): Promise<Record<string, unknown>[]> {
  if (!canRunKycSearch(role)) {
    throw Object.assign(new Error('KYC attribute search is restricted to investigator and auditor roles'), { statusCode: 403 });
  }
  const def = KYC_SEARCH_FIELDS.find((f) => f.key === req.field);
  if (!def) badRequest(`Unknown or non-searchable field: ${req.field}`);
  const mode = effectiveMode(def);
  const filter = buildKycFilter(def, mode, req);

  const { db: roleDb, hasValidToken, caseId } = await resolveDb(role, escalationToken);
  const canSee = canReadSensitive(role, hasValidToken);
  const cap = Math.min(Math.max(limit, 1), 100);

  const results: Record<string, unknown>[] = [];

  if (def.collection === 'party') {
    const parties = await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION)
      .find(filter as Partial<PartyControlRecord>).limit(cap).toArray();
    for (const party of parties) {
      const doc = await roleDb.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
        .findOne({ partyInstanceReference: party.partyInstanceReference });
      if (!doc) continue;
      await maybeAudit(roleDb, caseId, role, doc, canSee, actor);
      results.push(buildResponse(doc, party, role, canSee, caseId));
    }
  } else {
    const docs = await roleDb.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
      .find(filter as Partial<CustomerAgreementControlRecord>).limit(cap).toArray();
    for (const doc of docs) {
      const party = await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION)
        .findOne({ partyInstanceReference: doc.partyInstanceReference });
      if (!party) continue;
      await maybeAudit(roleDb, caseId, role, doc, canSee, actor);
      results.push(buildResponse(doc, party, role, canSee, caseId));
    }
  }

  return results;
}

// v27 Phase 6: persist a provider-produced HRP screening verdict onto the KYC check sub-document.
// The Integration Hub (SD-193) dispatches the kyc.screening.requested event to the screening
// provider; the provider-group reactor calls this to store the structured, auditable verdict.
// Writes go through the L2 QE client so the QE verdict fields (range/equality/none) encrypt on
// write, exactly like updateSelfProfile. Owning the DB write here keeps it out of the reactor.
export async function applyKycScreeningVerdict(
  partyInstanceReference: string,
  verdict: {
    riskScore: number;
    riskRating: 'low' | 'medium' | 'high';
    pepStatus: boolean;
    sanctionsResult: 'clear' | 'hit' | 'pending';
    screeningProviderRef: string;
    verificationStatus?: 'pass' | 'fail' | 'manual_review';
  },
  mode: DecisionMode = 'automated',
): Promise<boolean> {
  const roleDb = await getDbForRole('security_auditor', false);
  // v31 §3.7: derive the BQ:Step status from the verdict with the shared mapper and write it in the SAME
  // atomic update as the verdict fields (no drift between the risk verdict and the lifecycle status).
  const status = deriveKycCheckStatus(
    { riskRating: verdict.riskRating, pepStatus: verdict.pepStatus, sanctionsResult: verdict.sanctionsResult, verificationStatus: verdict.verificationStatus },
    mode,
  );
  const res = await roleDb.collection(CUSTOMER_AGREEMENT_COLLECTION).updateOne(
    { partyInstanceReference },
    {
      $set: {
        'customerAgreementKycCheck.customerAgreementKycCheckStatus': status,
        'customerAgreementKycCheck.customerAgreementKycCheckRiskScore': verdict.riskScore,
        'customerAgreementKycCheck.customerAgreementKycCheckRiskRating': verdict.riskRating,
        'customerAgreementKycCheck.customerAgreementKycCheckPepStatus': verdict.pepStatus,
        'customerAgreementKycCheck.customerAgreementKycCheckSanctionsResult': verdict.sanctionsResult,
        'customerAgreementKycCheck.customerAgreementKycCheckScreeningProviderRef': verdict.screeningProviderRef,
        recordUpdatedDateTime: new Date(),
      },
    },
  );
  return res.matchedCount > 0;
}

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
    sensitive: isSensitiveDecrypted(doc.customerAgreementResidentialAddress) ? {
      customerAgreementResidentialAddress: doc.customerAgreementResidentialAddress,
      governmentIdentificationReference:   doc.governmentIdentificationReference,
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
// Analysts search encrypted KYC fields (name, gov ID, TIN, DOB, verdicts) directly over
// ciphertext. The server encrypts the search value locally; Atlas never sees plaintext.
// API-first: this service is the single source of truth for which field maps to which QE
// query type, the validation rules, and the tier gate. The frontend renders only what the
// field registry exposes and enforces nothing the server does not (project CLAUDE.md).

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
  { key: 'partyName',            label: 'Name',              collection: 'party',     path: 'partyName',            baseMode: 'substring', bsonType: 'string', minQueryLength: 3, maxQueryLength: 30 },
  { key: 'partyDateOfBirth',     label: 'Date of birth',     collection: 'party',     path: 'partyDateOfBirth',     baseMode: 'range',     bsonType: 'date',   rangeMin: '1900-01-01', rangeMax: '2020-01-01' },
  { key: 'partyNationality',     label: 'Nationality',       collection: 'party',     path: 'partyNationality',     baseMode: 'equality',  bsonType: 'string', enumValues: ['ES','GB','US','FR','DE','IT','PT','PL','MX','NG'] },
  { key: 'partyPlaceOfBirth',    label: 'Place of birth',    collection: 'party',     path: 'partyPlaceOfBirth',    baseMode: 'equality',  bsonType: 'string' },
  { key: 'govIdNumber',          label: 'Government ID no.', collection: 'agreement', path: 'customerAgreementGovernmentID.number',         baseMode: 'suffix',   bsonType: 'string', minQueryLength: 3, maxQueryLength: 16 },
  { key: 'govIdType',            label: 'Government ID type',collection: 'agreement', path: 'customerAgreementGovernmentID.type',           baseMode: 'equality', bsonType: 'string', enumValues: ['passport','national_id','driver_license'] },
  { key: 'govIdIssuingCountry',  label: 'Issuing country',   collection: 'agreement', path: 'customerAgreementGovernmentID.issuingCountry', baseMode: 'equality', bsonType: 'string', enumValues: ['ES','GB','US','FR','DE','IT','PT','PL','MX','NG'] },
  { key: 'govIdExpiry',          label: 'ID expiry date',    collection: 'agreement', path: 'customerAgreementGovernmentID.expiryDate',     baseMode: 'range',    bsonType: 'date',   rangeMin: '2000-01-01', rangeMax: '2040-01-01' },
  { key: 'taxId',                label: 'Tax ID (TIN)',      collection: 'agreement', path: 'customerAgreementTaxIDNumber',                 baseMode: 'prefix',   bsonType: 'string', minQueryLength: 2, maxQueryLength: 16 },
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
  },
): Promise<boolean> {
  const roleDb = await getDbForRole('security_auditor', false);
  const res = await roleDb.collection(CUSTOMER_AGREEMENT_COLLECTION).updateOne(
    { partyInstanceReference },
    {
      $set: {
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

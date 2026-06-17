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
import { canReadSensitive } from '../../../vendors/middleware/rbac';
import { validateToken } from '../../../vendors/security/escalationTokens';
import { appendAuditEvent } from '../../fraud/services/fraudDiagnosis.service';
import { dispatchProvider } from '../../providers/services/integrationDispatch.service';
import { emitComplianceEvent } from '../../providers/services/businessProcessEvent.service';

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
  if (patch.customerMobilePhoneNumber) partyPatch.partyMobilePhoneNumber = patch.customerMobilePhoneNumber;
  if (patch.customerName) partyPatch.partyName = patch.customerName;

  if (Object.keys(partyPatch).length > 0) {
    partyPatch.recordUpdatedDateTime = new Date();
    await roleDb.collection(PARTY_COLLECTION).updateOne(
      { partyInstanceReference: party.partyInstanceReference },
      { $set: partyPatch }
    );
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
    void dispatchProvider(db, 'kyc_identity', 'auth.update.profile', {
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

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
import { validateToken } from '../../../vendors/security/escalationTokens';
import { appendAuditEvent } from '../../fraud/services/fraudDiagnosis.service';

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
  caseId?: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
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
    bianServiceDomain:                  doc.bianServiceDomain,
    bianControlRecordType:              doc.bianControlRecordType,
  };

  const addressDecrypted = isSensitiveDecrypted(doc.customerAgreementResidentialAddress);
  if (addressDecrypted) {
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

async function maybeAudit(db: Db, caseId: string | undefined, role: UserRole, doc: CustomerAgreementControlRecord): Promise<void> {
  if (!caseId) return;
  if (!isSensitiveDecrypted(doc.customerAgreementResidentialAddress)) return;
  await appendAuditEvent(db, caseId, 'field_accessed', role as 'level2_investigator' | 'security_auditor', {
    fields: ['customerAgreementResidentialAddress', 'governmentIdentificationReference', 'customerAgreementRiskNotes'],
    customerAgreementInstanceReference: doc.customerAgreementInstanceReference,
  });
}

// -- Public query functions --------------------------------------------------─

export async function getByEmail(db: Db, email: string, role: UserRole = 'level1_analyst', escalationToken?: string) {
  const { db: roleDb, caseId } = await resolveDb(role, escalationToken);
  const result = await findPartyAndAgreement(roleDb, { partyEmailAddress: email } as Partial<PartyControlRecord>);
  if (!result) return null;
  await maybeAudit(roleDb, caseId, role, result.doc);
  return buildResponse(result.doc, result.party, role, caseId);
}

export async function getByPhone(db: Db, phone: string, role: UserRole = 'level1_analyst', escalationToken?: string) {
  const { db: roleDb, caseId } = await resolveDb(role, escalationToken);
  const result = await findPartyAndAgreement(roleDb, { partyMobilePhoneNumber: phone } as Partial<PartyControlRecord>);
  if (!result) return null;
  await maybeAudit(roleDb, caseId, role, result.doc);
  return buildResponse(result.doc, result.party, role, caseId);
}

export async function getByAccountRef(db: Db, ref: string, role: UserRole = 'level1_analyst', escalationToken?: string) {
  const { db: roleDb, caseId } = await resolveDb(role, escalationToken);
  const doc = await roleDb.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerAgreementReference: ref } as Partial<CustomerAgreementControlRecord>);
  if (!doc) return null;
  const party = await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION)
    .findOne({ partyInstanceReference: doc.partyInstanceReference });
  if (!party) return null;
  await maybeAudit(roleDb, caseId, role, doc);
  return buildResponse(doc, party, role, caseId);
}

export async function getByInstanceReference(db: Db, id: string, role: UserRole = 'level1_analyst', escalationToken?: string) {
  const { db: roleDb, caseId } = await resolveDb(role, escalationToken);
  const doc = await roleDb.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerAgreementInstanceReference: id });
  if (!doc) return null;
  const party = await roleDb.collection<PartyControlRecord>(PARTY_COLLECTION)
    .findOne({ partyInstanceReference: doc.partyInstanceReference });
  if (!party) return null;
  await maybeAudit(roleDb, caseId, role, doc);
  return buildResponse(doc, party, role, caseId);
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

  return matched;
}

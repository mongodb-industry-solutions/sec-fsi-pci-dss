import { Db } from 'mongodb';
import {
  CUSTOMER_AGREEMENT_COLLECTION,
  CUSTOMER_AGREEMENT_SENSITIVE_COLLECTION,
  CustomerAgreementControlRecord,
  CustomerAgreementSensitiveRecord,
} from '../models/customerAgreement.model';
import type { UserRole } from '../../../shared/models/identity.model';
import { canReadSensitive } from '../../../vendors/middleware/rbac';
import { validateToken } from '../../../vendors/security/escalationTokens';
import { appendAuditEvent } from '../../fraud/services/fraudDiagnosis.service';

function stripQEFields(agreement: CustomerAgreementControlRecord) {
  // QE equality fields are used only as search predicates; never echoed back
  const { customerEmailAddress, customerMobilePhoneNumber, customerAgreementReference, ...safe } = agreement;
  void customerEmailAddress;
  void customerMobilePhoneNumber;
  void customerAgreementReference;
  return safe;
}

async function fetchSensitive(
  db: Db,
  ref: string
): Promise<CustomerAgreementSensitiveRecord | null> {
  return db
    .collection<CustomerAgreementSensitiveRecord>(CUSTOMER_AGREEMENT_SENSITIVE_COLLECTION)
    .findOne({ customerAgreementInstanceReference: ref });
}

async function buildResponse(
  db: Db,
  base: CustomerAgreementControlRecord,
  role: UserRole,
  escalationToken: string | undefined
): Promise<Record<string, unknown>> {
  const safeBase = stripQEFields(base);

  const tokenResult = validateToken(escalationToken);
  const hasValidToken = tokenResult.valid;

  if (!canReadSensitive(role, hasValidToken)) {
    if (role === 'level2_investigator') {
      throw { statusCode: 403, message: 'Escalation token required for Level 2 sensitive access' };
    }
    return safeBase;
  }

  // Fetch sensitive record (app-side join — ADR-001: no $lookup across QE collections)
  const sensitiveDoc = await fetchSensitive(db, base.customerAgreementInstanceReference);

  // Write audit event if we have a case context from the token
  const caseId = tokenResult.entry?.caseId;
  if (caseId) {
    await appendAuditEvent(db, caseId, 'field_accessed', role as 'level2_investigator' | 'security_auditor', {
      fields: ['customerAgreementResidentialAddress', 'governmentIdentificationReference', 'customerAgreementRiskNotes'],
      customerAgreementInstanceReference: base.customerAgreementInstanceReference,
    });
  }

  return {
    ...safeBase,
    ...(sensitiveDoc && {
      sensitive: {
        customerAgreementResidentialAddress: sensitiveDoc.customerAgreementResidentialAddress,
        governmentIdentificationReference: sensitiveDoc.governmentIdentificationReference,
        customerAgreementRiskNotes: sensitiveDoc.customerAgreementRiskNotes,
      },
    }),
  };
}

export async function getByEmail(db: Db, email: string, role: UserRole = 'level1_analyst', escalationToken?: string) {
  const doc = await db
    .collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerEmailAddress: email } as Partial<CustomerAgreementControlRecord>);
  if (!doc) return null;
  return buildResponse(db, doc, role, escalationToken);
}

export async function getByPhone(db: Db, phone: string, role: UserRole = 'level1_analyst', escalationToken?: string) {
  const doc = await db
    .collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerMobilePhoneNumber: phone } as Partial<CustomerAgreementControlRecord>);
  if (!doc) return null;
  return buildResponse(db, doc, role, escalationToken);
}

export async function getByAccountRef(db: Db, ref: string, role: UserRole = 'level1_analyst', escalationToken?: string) {
  const doc = await db
    .collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerAgreementReference: ref } as Partial<CustomerAgreementControlRecord>);
  if (!doc) return null;
  return buildResponse(db, doc, role, escalationToken);
}

// Look up by primary UUID — used by fraud case detail to load the linked customer profile.
// The UUID (customerAgreementInstanceReference) is a plaintext field, so no QE decryption
// is required for the lookup itself. Sensitive fields still require escalation token.
// Returns the full customer profile for self-service (/auth/me).
// Unlike the QE-search endpoints, this does NOT strip QE:equality fields —
// the customer is entitled to see their own email, phone, and account reference.
// Sensitive fields (address, govt ID) are always included with a clearly marked null
// when the sensitive record does not exist.
export async function getSelfProfile(db: Db, email: string): Promise<Record<string, unknown> | null> {
  const doc = await db
    .collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerEmailAddress: email } as Partial<CustomerAgreementControlRecord>);

  if (!doc) return null;

  const sensitive = await fetchSensitive(db, doc.customerAgreementInstanceReference);

  return {
    customerAgreementInstanceReference: doc.customerAgreementInstanceReference,
    customerName:                       doc.customerName,
    customerEmailAddress:               doc.customerEmailAddress,
    customerMobilePhoneNumber:          doc.customerMobilePhoneNumber,
    customerAgreementReference:         doc.customerAgreementReference,
    customerSegment:                    doc.customerSegment,
    customerAgreementStatus:            doc.customerAgreementStatus,
    customerAgreementEnrollmentDate:    doc.customerAgreementEnrollmentDate,
    customerAgreementPreferredLanguage: doc.customerAgreementPreferredLanguage,
    sensitive: sensitive
      ? {
          customerAgreementResidentialAddress: sensitive.customerAgreementResidentialAddress,
          governmentIdentificationReference:   sensitive.governmentIdentificationReference,
        }
      : null,
  };
}

export async function getByInstanceReference(db: Db, id: string, role: UserRole = 'level1_analyst', escalationToken?: string) {
  const doc = await db
    .collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerAgreementInstanceReference: id });
  if (!doc) return null;
  return buildResponse(db, doc, role, escalationToken);
}

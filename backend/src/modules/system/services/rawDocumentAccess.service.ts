// Authorization for the raw (undecrypted) document view. PCI DSS.
//
// Staff roles need `view` on the BIAN resource that owns the collection. The customer is authorized
// by ownership instead, proven server-side from its own identity (GDPR Art. 15).

import type { Db } from 'mongodb';
import type { Resource } from '../../../shared/models/acl.model';
import { can } from '../../../vendors/middleware/acl';
import { getDbForRole } from '../../../vendors/encryption/roleClients';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../customer/models/customerAgreement.model';
import { CARD_TRANSACTION_COLLECTION } from '../../transaction/models/cardTransaction.model';
import { PAYMENT_CARD_COLLECTION } from '../../customer/models/paymentCard.model';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../fraud/models/fraudDiagnosis.model';

// Collection to owning BIAN resource. Every collection exposed by the raw view must be listed here;
// an unlisted collection is denied (default-deny).
export const RAW_COLLECTION_RESOURCE: Readonly<Record<string, Resource>> = {
  party: 'customers',                          // Party
  customerAgreementProcedure: 'customers',     // Customer Agreement
  customerAuthenticationAssessment: 'customers', // the customer's own auth record
  cardTransactionLog: 'transactions',          // Card Transaction
  paymentCardManagement: 'cards',              // Payment Card
  fraudDiagnosisCase: 'fraudCases',            // Fraud Diagnosis
};

export interface RawAccessCaller {
  role?: string;
  partyRef?: string;
  sub?: string;
}

export type RawAccessDecision =
  | { allowed: true }
  | { allowed: false; status: 400 | 403; error: string; code?: string };

/** Roles scoped to their own records. Mirrors RoleRecord.roleScope === 'own'. */
const OWN_SCOPE_ROLES = new Set(['customer']);

/**
 * Resolve the caller's own agreement (instance + business reference) through the L1 QE client,
 * which can equality-search the encrypted customerAgreementReference field.
 */
async function ownAgreement(partyRef: string): Promise<{ instanceRef?: string; accountRef?: string }> {
  const db = await getDbForRole('level1_analyst', false);
  const doc = await db
    .collection<{ customerAgreementInstanceReference: string; customerAgreementReference?: string }>(
      CUSTOMER_AGREEMENT_COLLECTION,
    )
    .findOne({ partyInstanceReference: partyRef } as Record<string, unknown>);
  if (!doc) return {};
  return {
    instanceRef: doc.customerAgreementInstanceReference,
    ...(doc.customerAgreementReference ? { accountRef: doc.customerAgreementReference } : {}),
  };
}

/** True when the requested document belongs to the caller. Never trusts client input. */
async function ownsDocument(collection: string, id: string, caller: RawAccessCaller): Promise<boolean> {
  const partyRef = caller.partyRef;
  if (!partyRef) return false;

  if (collection === 'party') return id === partyRef;
  if (collection === 'customerAuthenticationAssessment') return !!caller.sub && id === caller.sub;

  const { instanceRef, accountRef } = await ownAgreement(partyRef);
  if (!instanceRef) return false;

  if (collection === CUSTOMER_AGREEMENT_COLLECTION) return id === instanceRef;

  const db = await getDbForRole('level1_analyst', false);

  if (collection === CARD_TRANSACTION_COLLECTION) {
    if (!accountRef) return false;
    // cardTransactionAccountReference is QE:equality, so the L1 client can match it.
    const hit = await db.collection(CARD_TRANSACTION_COLLECTION).findOne(
      { cardTransactionInstanceReference: id, cardTransactionAccountReference: accountRef } as Record<string, unknown>,
      { projection: { _id: 1 } },
    );
    return !!hit;
  }

  if (collection === PAYMENT_CARD_COLLECTION) {
    const hit = await db.collection(PAYMENT_CARD_COLLECTION).findOne(
      { paymentCardInstanceReference: id, customerAgreementInstanceReference: instanceRef } as Record<string, unknown>,
      { projection: { _id: 1 } },
    );
    return !!hit;
  }

  if (collection === FRAUD_DIAGNOSIS_COLLECTION) {
    const hit = await db.collection(FRAUD_DIAGNOSIS_COLLECTION).findOne(
      { fraudDiagnosisInstanceReference: id, customerAgreementInstanceReference: instanceRef } as Record<string, unknown>,
      { projection: { _id: 1 } },
    );
    return !!hit;
  }

  return false;
}

/**
 * Authorize a raw-document read. Returns a decision instead of throwing so the controller stays a
 * thin HTTP binding (hexagonal: the rule lives here and holds for any future caller).
 */
export async function authorizeRawDocumentAccess(
  db: Db,
  collection: string,
  id: string,
  caller: RawAccessCaller,
): Promise<RawAccessDecision> {
  const resource = RAW_COLLECTION_RESOURCE[collection];
  if (!resource) {
    return { allowed: false, status: 400, error: 'Unknown collection' };
  }

  const role = caller.role;

  if (role && OWN_SCOPE_ROLES.has(role)) {
    if (!(await ownsDocument(collection, id, caller))) {
      return {
        allowed: false,
        status: 403,
        error: 'Access denied: this document does not belong to you.',
        code: 'OWNERSHIP_DENIED',
      };
    }
    return { allowed: true };
  }

  if (!(await can(db, role, resource, 'view'))) {
    return {
      allowed: false,
      status: 403,
      error: `Access denied: your role does not permit view on ${resource}.`,
      code: 'ACL_DENIED',
    };
  }

  return { allowed: true };
}

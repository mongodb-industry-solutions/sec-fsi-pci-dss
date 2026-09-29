/**
 * Temporary authority the caller currently holds, resolved at the edge.
 *
 * Its PRESENCE means elevated; its scope says what for. Both matter: the second is what the audit
 * trail records, so a sensitive field read is attributable to the case it was read for rather than
 * just to the person. Losing the scope would keep the access and lose the reason.
 */
export interface Elevation {
  /** The case, change window or review this authority was granted for. */
  caseRef: string;
}

import type { FastifyRequest } from 'fastify';

export type UserRole =
  | 'customer'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor'
  | 'merchant_officer'    // Ch-05: Merchant Acquiring officer
  | 'operations_officer' // v29: cardholder & payout-account operations (built-in module admin)
  | 'manager';           // Ch-07: Integration Hub administrator

export type AnalystRole =
  | 'payment_service'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor'
  | 'merchant_officer'  // Ch-05: can view fraud cases linked to their merchants
  | 'ai_agent'
  | 'customer';         // the subject answering an investigator's question (customer response)

export interface JwtUserPayload {
  sub: string;
  email: string;
  role: UserRole;
  name: string;
  domain: string;
  partyRef?: string;  // Ch-05: partyInstanceReference , present for all users with a Party record
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends FastifyRequest {
  userRole: UserRole;
  elevation?: Elevation;
}

import type { FastifyRequest } from 'fastify';

export type UserRole =
  | 'customer'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor'
  | 'merchant_officer'    // Ch-05: SD-89 Merchant Acquiring officer
  | 'operations_officer' // v29: SD-88/SD-66 cardholder & payout-account operations (built-in module admin)
  | 'manager';           // Ch-07: SD-193 Integration Hub administrator

export type AnalystRole =
  | 'payment_service'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor'
  | 'merchant_officer'  // Ch-05: can view fraud cases linked to their merchants
  | 'ai_agent'
  | 'customer';         // SD-83: the subject answering an investigator's question (customer response)

export interface JwtUserPayload {
  sub: string;
  email: string;
  role: UserRole;
  name: string;
  domain: string;
  partyRef?: string;  // Ch-05: partyInstanceReference (SD-13) — present for all users with a Party record
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends FastifyRequest {
  userRole: UserRole;
  escalationToken?: string;
}

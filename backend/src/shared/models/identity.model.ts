import type { FastifyRequest } from 'fastify';

export type UserRole =
  | 'customer'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor'
  | 'merchant_officer';   // Ch-05: SD-89 Merchant Acquiring officer

export type AnalystRole =
  | 'payment_service'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor'
  | 'merchant_officer'  // Ch-05: can view fraud cases linked to their merchants
  | 'ai_agent';

export interface JwtDemoPayload {
  sub: string;
  email: string;
  role: UserRole;
  name: string;
  domain: string;
  partyRef?: string;  // Ch-05: partyInstanceReference (SD-13) — present for all users with a Party record
  iat: number;
  exp: number;
}

export interface DemoRequest extends FastifyRequest {
  demoRole: UserRole;
  escalationToken?: string;
}

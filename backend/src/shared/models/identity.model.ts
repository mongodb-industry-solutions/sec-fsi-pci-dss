import type { FastifyRequest } from 'fastify';

export type UserRole =
  | 'customer'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor';

export type AnalystRole =
  | 'payment_service'
  | 'level1_analyst'
  | 'level2_investigator'
  | 'security_auditor'
  | 'ai_agent';

export interface JwtDemoPayload {
  sub: string;
  email: string;
  role: UserRole;
  name: string;
  domain: string;
  iat: number;
  exp: number;
}

export interface DemoRequest extends FastifyRequest {
  demoRole: UserRole;
  escalationToken?: string;
}

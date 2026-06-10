import { FastifyRequest } from 'fastify';
import type { JwtDemoPayload, UserRole, DemoRequest } from '../../shared/models/identity.model';

export const VALID_DEMO_ROLES: ReadonlySet<UserRole> = new Set([
  'customer',
  'level1_analyst',
  'level2_investigator',
  'security_auditor',
  'merchant_officer',     // Ch-05: SD-89 Merchant Acquiring officer
  'manager',             // Ch-07: SD-193 Integration Hub administrator
]);

export function extractDemoRole(request: FastifyRequest): UserRole {
  const header = request.headers['x-demo-role'] as string | undefined;
  if (header && VALID_DEMO_ROLES.has(header as UserRole)) {
    return header as UserRole;
  }
  const user = (request as FastifyRequest & { user?: JwtDemoPayload }).user;
  if (user?.role && VALID_DEMO_ROLES.has(user.role)) {
    return user.role;
  }
  return 'level1_analyst';
}

// Roles that can see sensitive fields without an escalation token
export const SENSITIVE_READ_ROLES: ReadonlySet<UserRole> = new Set([
  'security_auditor',
]);

// Roles that require an escalation token to access sensitive fields
export const ESCALATION_REQUIRED_ROLES: ReadonlySet<UserRole> = new Set([
  'level2_investigator',
]);

export function canReadSensitive(role: UserRole, hasValidToken: boolean): boolean {
  if (SENSITIVE_READ_ROLES.has(role)) return true;
  if (ESCALATION_REQUIRED_ROLES.has(role)) return hasValidToken;
  return false;
}

export function attachRbacContext(request: FastifyRequest): void {
  const demoReq = request as unknown as DemoRequest;
  demoReq.demoRole = extractDemoRole(request);
  demoReq.escalationToken = request.headers['x-escalation-token'] as string | undefined;
}

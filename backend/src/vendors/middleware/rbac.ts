import { FastifyRequest } from 'fastify';
import type { JwtUserPayload, UserRole, AuthenticatedRequest } from '../../shared/models/identity.model';

export const VALID_USER_ROLES: ReadonlySet<UserRole> = new Set([
  'customer',
  'level1_analyst',
  'level2_investigator',
  'security_auditor',
  'merchant_officer',     // Ch-05: SD-89 Merchant Acquiring officer
  'manager',             // Ch-07: SD-193 Integration Hub administrator
]);

export function extractUserRole(request: FastifyRequest): UserRole {
  // The x-user-role header is UNTRUSTED (simulator convenience, no token) — restrict it to builtins.
  const header = request.headers['x-user-role'] as string | undefined;
  if (header && VALID_USER_ROLES.has(header as UserRole)) {
    return header as UserRole;
  }
  // A JWT role is signed by us at login from the stored user record, so it is TRUSTED — return it
  // as-is even when it is a custom role (ADR-030). Authorization is enforced by the ACL (`can()`),
  // not by this union, so custom roles resolve correctly without widening the type everywhere.
  const user = (request as FastifyRequest & { user?: JwtUserPayload }).user;
  if (user?.role) {
    return user.role as UserRole;
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
  const demoReq = request as unknown as AuthenticatedRequest;
  demoReq.userRole = extractUserRole(request);
  demoReq.escalationToken = request.headers['x-escalation-token'] as string | undefined;
}

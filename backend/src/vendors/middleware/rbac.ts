import { FastifyRequest } from 'fastify';
import type { JwtUserPayload, UserRole, AuthenticatedRequest } from '../../shared/models/identity.model';

export const VALID_USER_ROLES: ReadonlySet<UserRole> = new Set([
  'customer',
  'level1_analyst',
  'level2_investigator',
  'security_auditor',
  'merchant_officer',     // Ch-05: Merchant Acquiring officer
  'manager',             // Ch-07: Integration Hub administrator
]);

export function extractUserRole(request: FastifyRequest): UserRole {
  // The x-user-role header is UNTRUSTED (simulator convenience, no token): restrict it to builtins.
  const header = request.headers['x-user-role'] as string | undefined;
  if (header && VALID_USER_ROLES.has(header as UserRole)) {
    return header as UserRole;
  }
  // A JWT role is signed by us at login from the stored user record, so it is TRUSTED: return it
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

// Roles authorised to perform the audited reveal of the QE:none KYC fields. Named capability that
// grants the sensitive-tier QE client; the route also gates on customers:manage or viewSensitive.
export const KYC_ADMIN_REVEAL_ROLES: ReadonlySet<UserRole> = new Set([
  'operations_officer' as UserRole, // v31 KYC data administration (customers:manage)
  'security_auditor',               // read-only oversight, sensitive tier without a token
]);

export function canRevealKycSensitive(role: UserRole, hasValidToken = false): boolean {
  return KYC_ADMIN_REVEAL_ROLES.has(role) || canReadSensitive(role, hasValidToken);
}

// Staff investigation roles (v27 profile staff view, PCI DSS least privilege).
// VIEW of a found customer's related data (transactions, authorized apps, accounts, cards) is
// limited to these roles; L1 analyst and customer are blocked. Mirrors KYC_SEARCH_ROLES.
export const STAFF_INVESTIGATION_ROLES: ReadonlySet<UserRole> = new Set([
  'level2_investigator',
  'security_auditor',
]);

// May a role VIEW another party's related data on the staff profile page (read)?
export function canStaffInvestigate(role: UserRole): boolean {
  return STAFF_INVESTIGATION_ROLES.has(role);
}

// May a role perform a staff MUTATION on another party's data (deactivate/remove a card, revoke a
// grant they do not own)? Investigator only. The auditor is read-only, L1 has no reach here.
export function canStaffMutate(role: UserRole): boolean {
  return role === 'level2_investigator';
}

export function attachRbacContext(request: FastifyRequest): void {
  const demoReq = request as unknown as AuthenticatedRequest;
  demoReq.userRole = extractUserRole(request);
  demoReq.escalationToken = request.headers['x-escalation-token'] as string | undefined;
}

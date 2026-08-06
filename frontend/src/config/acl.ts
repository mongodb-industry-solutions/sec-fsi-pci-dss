// ── Frontend mirror of the ACL catalog (ADR-030) ─────────────────────────────
// Kept in sync with backend/src/shared/models/acl.model.ts. Permissions themselves come from
// GET /api/v1/acl/effective at runtime (never from the JWT); this file only describes the catalog
// and provides labels for the role matrix editor (Phase B).

export const RESOURCES = [
  'transactions', 'customers', 'cards', 'fraudCases', 'merchants',
  'providers', 'modules', 'authDomains', 'roles', 'auditEvents', 'consents',
  'accounts', 'beneficiaries', 'paymentRequests',
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ['view', 'viewSensitive', 'manage', 'investigate'] as const;
export type Action = (typeof ACTIONS)[number];

export const RESOURCE_LABELS: Record<string, string> = {
  transactions: 'Transactions',
  customers: 'Customers',
  cards: 'Payment Cards',
  fraudCases: 'Fraud Cases',
  merchants: 'Merchants',
  providers: 'Providers',
  modules: 'Modules',
  authDomains: 'Auth Domains',
  roles: 'Roles',
  auditEvents: 'Audit Events',
  consents: 'Consents',
  accounts: 'Payout Accounts',
  beneficiaries: 'Beneficiaries',
  paymentRequests: 'Payment Requests (RTP)',
};

export const ACTION_LABELS: Record<string, string> = {
  view: 'View',
  viewSensitive: 'View sensitive (CHD/PII)',
  manage: 'Manage',
  investigate: 'Investigate',
};

// BIAN service-domain hint per resource (shown in the matrix editor / AccessDenied for traceability).
export const RESOURCE_BIAN: Record<string, string> = {
  transactions: 'Card Transaction',
  customers: 'Customer Agreement',
  cards: 'Payment Card',
  fraudCases: 'Fraud Diagnosis',
  merchants: 'Merchant Relations',
  providers: 'External Provider Arrangements',
  modules: 'ADR-029 Capability Modules',
  authDomains: 'Party Authentication',
  roles: 'RBAC',
  auditEvents: 'ADR-025 · PCI DSS',
  consents: 'Open Banking Consent',
  accounts: 'Payout Account Arrangement',
  beneficiaries: 'Counterparty Administration',
  paymentRequests: 'Payment Order (Request to Pay)',
};

export type AclPermissionMap = Record<string, string[]>;

// Pure default-deny check. Mirrors backend hasPermission().
export function hasPermission(perms: AclPermissionMap | undefined, resource: string, action: string): boolean {
  if (!perms) return false;
  return perms[resource]?.includes(action) ?? false;
}

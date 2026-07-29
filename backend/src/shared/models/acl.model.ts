// ── Data-driven RBAC/ACL (ADR-030) ───────────────────────────────────────────
// PCI DSS Req 7 (role-based access control, least privilege, default-deny, documented
// matrix + separation of duties) · BIAN SD-16 (Party Authentication).
//
// E1 (plan §13): the permission CATALOG (resource × action) is STATIC — it mirrors the real
// enforcement points, so no permission exists without a guard. The role→permission ASSIGNMENT
// is DATA (the `role` collection, CRUD by the manager). Builtin roles seed from BUILTIN_ROLES.

export const ROLE_COLLECTION = 'role';

// Resources map 1:1 to BIAN Service Domains (or ADRs) — the protected business/admin areas.
export const RESOURCES = [
  'transactions',   // SD-254 Card Transaction
  'customers',      // SD-53 Customer Agreement
  'cards',          // SD-88 Payment Card
  'fraudCases',     // SD-83 Fraud Diagnosis
  'merchants',      // SD-89 Merchant Relations
  'providers',      // SD-193 External Provider Arrangements
  'modules',        // ADR-029 internal capability modules
  'authDomains',    // SD-16 Party Authentication
  'roles',          // SD-16 RBAC administration
  'auditEvents',    // ADR-025 / PCI Req 10
  'consents',       // Open Banking consent
  'accounts',       // SD-66 Payout Account Arrangement (v17)
  'beneficiaries',  // SD-54 Counterparty Administration (v18)
  'paymentRequests', // SD-65 Payment Order — Request to Pay intent domain (v28)
] as const;
export type Resource = (typeof RESOURCES)[number];

// Actions are PCI-aligned access levels. `viewSensitive` gates CHD/PII (Req 3/7) and is bound to
// the existing escalation flow (canReadSensitive). `own` scope (customer) is enforced in-handler.
export const ACTIONS = ['view', 'viewSensitive', 'manage', 'investigate'] as const;
export type Action = (typeof ACTIONS)[number];

export type RolePermissions = Partial<Record<Resource, Action[]>>;

export interface RoleRecord {
  roleName: string;                 // PK (unique). Matches JwtUserPayload.role.
  roleLabel: string;
  roleDescription?: string;
  rolePermissions: RolePermissions; // { [resource]: action[] } — default-deny: absent ⇒ no access
  roleScope: 'own' | 'all';         // `own` = record-level scope to the caller (customer)
  roleIsBuiltin: boolean;           // builtin: editable permissions, NOT deletable (E3)
  bianServiceDomain: string;
  bianControlRecordType: string;
  recordCreatedDateTime: Date | string;
  recordUpdatedDateTime: Date | string;
}

// Builtin role matrix (plan §13.2). Seeded into the `role` collection; also the in-code fallback
// if the collection is unavailable, so enforcement never fails open or hard-crashes.
export const BUILTIN_ROLES: Array<Omit<RoleRecord, 'recordCreatedDateTime' | 'recordUpdatedDateTime'>> = [
  {
    roleName: 'customer',
    roleLabel: 'Customer',
    roleDescription: 'Account holder — own transactions, own stored cards and own consents only.',
    roleScope: 'own',
    roleIsBuiltin: true,
    bianServiceDomain: 'Customer Agreement',
    bianControlRecordType: 'CustomerAgreement',
    rolePermissions: {
      transactions: ['view'],
      cards: ['view', 'manage'],
      merchants: ['view'],
      consents: ['view'],
      accounts: ['view', 'manage'],
      beneficiaries: ['view', 'manage'],  // SD-54: own contacts (scope: own enforced per-handler)
      paymentRequests: ['view', 'manage'], // SD-65: own RTP requests (create/approve/reject/cancel)
    },
  },
  {
    roleName: 'level1_analyst',
    roleLabel: 'L1 Fraud Analyst',
    roleDescription: 'First-line fraud triage: view transactions/customers/cards, investigate cases, escalate to L2.',
    roleScope: 'all',
    roleIsBuiltin: true,
    bianServiceDomain: 'Fraud Diagnosis',
    bianControlRecordType: 'FraudDiagnosisCase',
    rolePermissions: {
      transactions: ['view'],
      customers: ['view'],
      cards: ['view'],
      merchants: ['view'],
      fraudCases: ['view', 'investigate'],
      auditEvents: ['view'],
      beneficiaries: ['view'],  // SD-54: read-only view of beneficiary contacts
    },
  },
  {
    roleName: 'level2_investigator',
    roleLabel: 'L2 Investigator',
    roleDescription: 'Senior investigator: L1 access plus sensitive CHD/PII via an escalation token, and case resolution.',
    roleScope: 'all',
    roleIsBuiltin: true,
    bianServiceDomain: 'Fraud Diagnosis',
    bianControlRecordType: 'FraudDiagnosisCase',
    rolePermissions: {
      transactions: ['view', 'viewSensitive'],
      customers: ['view', 'viewSensitive'],
      cards: ['view', 'viewSensitive'],
      merchants: ['view'],
      fraudCases: ['view', 'investigate'],
      auditEvents: ['view'],
      accounts: ['view', 'viewSensitive'],  // PCI Req 3.3 — IBAN reveal for fraud investigations
      beneficiaries: ['view', 'manage'],    // SD-54: can edit/remove beneficiary contacts for investigations
      paymentRequests: ['view'],            // SD-65: read RTP requests for investigations
    },
  },
  {
    roleName: 'security_auditor',
    roleLabel: 'Security Auditor',
    roleDescription: 'Read-only global oversight, including sensitive fields, plus integration/config visibility. No mutations.',
    roleScope: 'all',
    roleIsBuiltin: true,
    bianServiceDomain: 'Party Authentication',
    bianControlRecordType: 'PartyAuthenticationAssessment',
    rolePermissions: {
      transactions: ['view', 'viewSensitive'],
      customers: ['view', 'viewSensitive'],
      cards: ['view', 'viewSensitive'],
      fraudCases: ['view', 'viewSensitive'],
      merchants: ['view'],
      providers: ['view'],
      modules: ['view'],
      auditEvents: ['view'],
      accounts: ['view', 'viewSensitive'],
      beneficiaries: ['view', 'manage'],  // SD-54: full audit visibility
      paymentRequests: ['view'],          // SD-65: full audit visibility of RTP requests
    },
  },
  {
    // KYB DECISION authority (SD-89). v31 SoD split: merchant_officer owns the KYB *decision*
    // (review → approve/reject/suspend via the merchant/review flow, the Control action). This is
    // distinct from operations_officer, who owns KYB *data correction* (fields + beneficial owners)
    // on already-registered merchants. Both share the `merchants` resource and emit the same
    // compliance events; the boundary is procedural (decision vs correction) and recorded in the
    // audit actorPartyReference. Verdict override stays here, never on the Administration surface.
    roleName: 'merchant_officer',
    roleLabel: 'Merchant Officer',
    roleDescription: 'Merchant acquiring: KYB decision authority (review → approve/reject/suspend) and merchant configuration. Decision path, distinct from operations_officer data correction (SoD, PCI Req 7).',
    roleScope: 'all',
    roleIsBuiltin: true,
    bianServiceDomain: 'Merchant Relations',
    bianControlRecordType: 'MerchantAgreement',
    rolePermissions: {
      merchants: ['view', 'manage'],
      auditEvents: ['view'],
      accounts: ['view'],
    },
  },
  {
    // v29: global operations of cardholder cards (SD-88) and payout accounts (SD-66) through the
    // built-in modules (card-issuer / account-information). BIAN has no staff "Card/Account
    // Administrator" role for SD-88/SD-66 (data domains), so we follow the project's established
    // "<area>_officer" bank-employee convention (precedent: merchant_officer → SD-89). SoD (PCI Req 7):
    // distinct from `manager` (SD-193, no CHD) and from `customer` (scope own, self-service).
    roleName: 'operations_officer',
    roleLabel: 'Operations Officer',
    roleDescription: 'Operations: administers cardholder cards (SD-88) and payout accounts (SD-66) via the built-in modules, plus KYC (SD-53) and KYB (SD-89) data administration (review/correct records and beneficial owners). KYB decision (approve/reject) stays with merchant_officer (SoD, PCI Req 7).',
    roleScope: 'all',
    roleIsBuiltin: true,
    bianServiceDomain: 'Payment Card / Payout Account Arrangement',
    bianControlRecordType: 'PaymentCardManagement / PayoutAccountArrangement',
    rolePermissions: {
      cards: ['view', 'manage'],
      accounts: ['view', 'manage'],
      // v31: KYC/KYB DATA ADMINISTRATION (review + correction of KYC/KYB records and beneficial
      // owners). Administration is gated by the DATA resource (customers / merchants), NOT by
      // `modules`, so it stays SoD-clean: no "modules can edit any business data" bypass.
      //   customers → SD-53 KYC record review/correction (occupation, source of funds, gov ID,
      //     address, purpose). `viewSensitive` NOT granted here: decrypted CHD-adjacent identity
      //     fields still require the L2 escalation token, exactly like the investigator path.
      //   merchants → SD-89 KYB data correction + beneficial-owner (UBO) administration on
      //     already-registered merchants. This is the *correction* half of the v31 SoD split;
      //     the KYB *decision* (approve/reject/suspend) stays with `merchant_officer`. Both emit
      //     the same compliance events; neither replaces the other (PCI Req 7).
      customers: ['view', 'manage'],
      merchants: ['view', 'manage'],
      // v29.1: administer the INTERNAL capability modules (engine config / policies of fds, aml, hrp,
      // kyc, kyb, credit-bureau, card-authorization, card-issuer, account-information, payment-initiation,
      // vop). Auth (SD-16) stays with `manager` because it is the separate `authDomains` resource, not
      // `modules`. `manager` keeps `modules` too (platform super-admin); this is an accepted overlap.
      modules: ['view', 'manage'],
      // v29.2: READ-ONLY visibility of external providers (SD-193), so the operations landing can show
      // which provider currently serves each capability (internal vs external / managed_externally).
      // NO `manage`: provider CRUD/routing stays with `manager` (SoD, PCI Req 7).
      providers: ['view'],
      auditEvents: ['view'],
    },
  },
  {
    roleName: 'manager',
    roleLabel: 'Integration Manager',
    roleDescription: 'Platform administrator (SD-193): providers, modules, auth domains and roles. No access to business/cardholder data (SoD, PCI Req 7).',
    roleScope: 'all',
    roleIsBuiltin: true,
    bianServiceDomain: 'External Provider Arrangements',
    bianControlRecordType: 'ExternalProviderArrangement',
    rolePermissions: {
      providers: ['view', 'manage'],
      // v29.2: system oversight only. Internal module engine/policy config is a business/risk process
      // owned by `operations_officer` (view+manage); `manager` keeps `modules:view` for platform
      // troubleshooting/security oversight but does not edit business policies (SoD, PCI Req 7).
      modules: ['view'],
      authDomains: ['view', 'manage'],
      roles: ['view', 'manage'],
      auditEvents: ['view'],
    },
  },
];

// Pure default-deny check against a permission map. Exported for reuse on both back and front.
export function hasPermission(perms: RolePermissions | undefined, resource: Resource, action: Action): boolean {
  if (!perms) return false;
  return perms[resource]?.includes(action) ?? false;
}

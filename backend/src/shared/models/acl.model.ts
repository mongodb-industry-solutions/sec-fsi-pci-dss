// ── Data-driven RBAC/ACL (ADR-030) ───────────────────────────────────────────
// PCI DSS (role-based access control, least privilege, default-deny, documented
// matrix + separation of duties) (Party Authentication).
//
// E1 (plan §13): the permission CATALOG (resource × action) is STATIC, it mirrors the real
// enforcement points, so no permission exists without a guard. The role→permission ASSIGNMENT
// is DATA (the `role` collection, CRUD by the manager). Builtin roles seed from BUILTIN_ROLES.

export const ROLE_COLLECTION = 'role';

// Resources map 1:1 to BIAN Service Domains (or ADRs), the protected business/admin areas.
export const RESOURCES = [
  'transactions',   // Card Transaction
  'customers',      // Customer Agreement
  'cards',          // Payment Card
  'fraudCases',     // Fraud Diagnosis
  'merchants',      // Merchant Relations
  'providers',      // External Provider Arrangements
  'modules',        // ADR-029 internal capability modules
  'authDomains',    // Party Authentication
  'roles',          // RBAC administration
  'auditEvents',    // ADR-025 / PCI DSS
  'consents',       // Open Banking consent
  'accounts',       // Payout Account Arrangement (v17)
  'beneficiaries',  // Counterparty Administration (v18)
  'paymentRequests', // Payment Order: Request to Pay intent domain (v28)
] as const;
export type Resource = (typeof RESOURCES)[number];

// Actions are PCI-aligned access levels. `viewSensitive` gates CHD/PII and is bound to
// the existing escalation flow (canReadSensitive). `own` scope (customer) is enforced in-handler.
export const ACTIONS = ['view', 'viewSensitive', 'manage', 'investigate'] as const;
export type Action = (typeof ACTIONS)[number];

export type RolePermissions = Partial<Record<Resource, Action[]>>;

export interface RoleRecord {
  roleName: string;                 // PK (unique). Matches JwtUserPayload.role.
  roleLabel: string;
  roleDescription?: string;
  rolePermissions: RolePermissions; // { [resource]: action[] }, default-deny: absent ⇒ no access
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
    roleDescription: 'Account holder, own transactions, own stored cards and own consents only.',
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
      beneficiaries: ['view', 'manage'],  // own contacts (scope: own enforced per-handler)
      paymentRequests: ['view', 'manage'], // own RTP requests (create/approve/reject/cancel)
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
      // No `auditEvents`: the platform-wide event stream is cross-entity (every customer, merchant
      // and integration payload), which first-line triage has no job-related need for
      // (PCI DSS, NIST AU-9, ISO 27001 A.8.15). It would also contradict the
      // no-enumeration rule below. L1 still gets the per-case trail via fraudCases:investigate.
      // v32 A2 (ADR-048): `view` is drill-down for a KNOWN owner party reference. Cross-party SEARCH
      // needs `investigate`, which L1 deliberately does NOT hold: first-line triage has no need to
      // enumerate counterparties across the whole customer base (PCI DSS 7.2.2, EBA §31(a)).
      beneficiaries: ['view'],
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
      accounts: ['view', 'viewSensitive'],  // PCI DSS, IBAN reveal for fraud investigations
      // v32 A2: `investigate` authorises cross-party beneficiary SEARCH (ADR-048).
      beneficiaries: ['view', 'investigate', 'manage'],  // search + edit/remove for investigations
      paymentRequests: ['view'],            // read RTP requests for investigations
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
      // v32 A8: the role is documented as read-only global oversight, yet it held `manage` and the UI
      // rendered Add/Remove for it. A read-only auditor able to delete a beneficiary is a
      // segregation-of-duties finding (EBA/GL/2019/04 §31(a), ISO 27001 A.8.2, PCI DSS).
      // `investigate` gives it the cross-party search it actually needs (ADR-048).
      beneficiaries: ['view', 'investigate'],  // full audit visibility, READ-ONLY
      paymentRequests: ['view'],          // full audit visibility of RTP requests
    },
  },
  {
    // KYB DECISION authority . v31 SoD split: merchant_officer owns the KYB *decision*
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
      // No `auditEvents`: a KYB officer would otherwise read events for merchants and customers
      // unrelated to any file under review (PCI DSS, need-to-know).
      accounts: ['view'],
    },
  },
  {
    // Global operations of cardholder cards and payout accounts, through the card issuer and account
    // information capabilities. A PAYMENT SERVICE PROVIDER staff role, not a bank employee one: acquiring
    // and card-on-file administration are the provider's functions, and `merchant_officer` alongside it is
    // the same, since onboarding merchants is acquiring. v37 changed which API these roles call, not which
    // institution they belong to: the cards and accounts moved to the bank, so this role now operates
    // against the bank through the provider rather than against a local collection.
    // Separation of duties: distinct from `manager` (no cardholder data) and from `customer` (own scope).
    roleName: 'operations_officer',
    roleLabel: 'Operations Officer',
    roleDescription: 'Operations: administers cardholder cards and payout accounts through the platform capabilities, plus customer and business identity data administration (reviewing and correcting records and beneficial owners). The decision to approve or reject a business stays with the merchant officer, kept apart on purpose.',
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
      //   customers → KYC record review/correction (occupation, source of funds, gov ID,
      //     address, purpose). `viewSensitive` NOT granted here: decrypted CHD-adjacent identity
      //     fields still require the L2 escalation token, exactly like the investigator path.
      //   merchants → KYB data correction + beneficial-owner (UBO) administration on
      //     already-registered merchants. This is the *correction* half of the v31 SoD split;
      //     the KYB *decision* (approve/reject/suspend) stays with `merchant_officer`. Both emit
      //     the same compliance events; neither replaces the other (PCI DSS).
      customers: ['view', 'manage'],
      merchants: ['view', 'manage'],
      // v29.1: administer the INTERNAL capability modules (engine config / policies of fds, aml, hrp,
      // kyc, kyb, credit-bureau, card-authorization, card-issuer, account-information, payment-initiation,
      // vop). Auth stays with `manager` because it is the separate `authDomains` resource, not
      // `modules`. `manager` keeps `modules` too (platform super-admin); this is an accepted overlap.
      modules: ['view', 'manage'],
      // v29.2: READ-ONLY visibility of external providers , so the operations landing can show
      // which provider currently serves each capability (internal vs external / managed_externally).
      // NO `manage`: provider CRUD/routing stays with `manager` (SoD, PCI DSS).
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
      // troubleshooting/security oversight but does not edit business policies (SoD, PCI DSS).
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

import { Users, Search, KeyRound, ScrollText, CheckSquare, Database, Wallet, type LucideIcon } from 'lucide-react';

// Role responsibilities reference (shared by /system/help and /system/help/roles/[role]).
// Explains what each role is accountable for, what data it may touch, the PCI DSS requirements
// that scope it, and its hard limits. Aligned with the demo's RBAC (ADR-030 ACL matrix).
export interface RoleGuide {
  icon: LucideIcon;
  tagline: string;
  responsibilities: string[];
  dataAccess: string[];
  restrictions: string[];
  pci: string[];
}

export const ROLE_GUIDE: Record<string, RoleGuide> = {
  customer: {
    icon: Users,
    tagline: 'Initiate your own payments and review your own transaction history. Optionally, also operate as a merchant.',
    responsibilities: [
      'Initiate card payments through the checkout flow.',
      'Review your own transaction history and payment status.',
      'Optionally onboard as a merchant: a customer may also be a merchant at the same time (BIAN dual-role, Ch-05). It is not required; you remain a customer either way.',
      'To become one, submit a merchant application. Once a merchant officer completes the KYB review and approves it, you can accept payments and manage that merchant.',
      'If you own an approved merchant, manage its profile, API keys, and webhooks.',
    ],
    dataAccess: [
      'Only your own transactions and, if you onboarded one, your own merchant record (same party, two roles).',
      'Card numbers are always shown masked (****-****-****-1234); full PAN is never exposed.',
    ],
    restrictions: [
      'No visibility into other customers, fraud cases, or audit logs.',
      'Cannot decrypt any cardholder data.',
      'Merchant capabilities apply only after KYB approval; a pending application grants no merchant access.',
    ],
    pci: ['Req 3', 'Req 7', 'Req 12'],
  },
  level1_analyst: {
    icon: Search,
    tagline: 'First-line fraud triage: review queued cases and search by encrypted card reference.',
    responsibilities: [
      'Review the fraud case queue and triage incoming cases.',
      'Search transactions by encrypted card reference (QE equality search).',
      'Add investigation notes and escalate cases to L2 when deeper access is required.',
    ],
    dataAccess: [
      'Fraud cases and their linked transactions.',
      'Searches run against encrypted fields; the database never sees plaintext PAN; the PAN stays masked in the UI.',
    ],
    restrictions: [
      'Cannot decrypt the full PAN or sensitive customer profile fields.',
      'Cannot resolve a case as confirmed fraud without escalation; no admin or Integration Hub access.',
    ],
    pci: ['Req 3', 'Req 7', 'Req 10'],
  },
  level2_investigator: {
    icon: KeyRound,
    tagline: 'Deep investigation with authorized decryption of sensitive fields for assigned cases.',
    responsibilities: [
      'Conduct full investigation on escalated cases.',
      'Access decrypted customer profile and full PAN for cases under investigation.',
      'Resolve and close cases, documenting the outcome and rationale.',
    ],
    dataAccess: [
      'Authorized decryption of QE-protected fields (full PAN, customer profile) for assigned cases.',
      'Full transaction detail and the complete case activity log.',
    ],
    restrictions: [
      'Every field-level decryption is logged and auditable.',
      'Elevated access is scoped to assigned cases; not a blanket grant.',
    ],
    pci: ['Req 3', 'Req 7', 'Req 8', 'Req 10'],
  },
  security_auditor: {
    icon: ScrollText,
    tagline: 'Read-only compliance oversight: review logs and verify control effectiveness.',
    responsibilities: [
      'Review audit logs and business/compliance process event logs.',
      'Produce compliance reports and evidence for assessments.',
      'Verify that access controls and logging are operating as designed.',
    ],
    dataAccess: [
      'System-wide audit and process event logs; aggregate fraud statistics.',
      'No PAN decryption; oversight does not require cardholder data.',
    ],
    restrictions: [
      'Strictly read-only: cannot modify cases, transactions, or configuration.',
    ],
    pci: ['Req 10', 'Req 12'],
  },
  merchant_officer: {
    icon: CheckSquare,
    tagline: 'Merchant onboarding and KYB review across the merchant portfolio.',
    responsibilities: [
      'Work the merchant onboarding review queue.',
      'Perform KYB checks and approve or reject merchant agreements.',
      'Maintain the merchant registry and document review decisions.',
    ],
    dataAccess: [
      'Merchant agreements, KYB data, and the full merchant portfolio.',
      'No cardholder PAN; the merchant lifecycle does not require it.',
    ],
    restrictions: [
      'No fraud case or audit log access; no access to cardholder data.',
    ],
    pci: ['Req 7', 'Req 12'],
  },
  operations_officer: {
    icon: Wallet,
    tagline: 'Global operations: administer customer cards (SD-88) and payout accounts (SD-66) through the built-in modules.',
    responsibilities: [
      'Administer the global card inventory: register, edit, activate/suspend, and revoke customer cards via the built-in card-issuer module.',
      'Administer payout accounts: create, edit, and close party payout accounts via the built-in account-information module.',
      'Keep the card and account registries accurate for downstream payment and payout operations.',
    ],
    dataAccess: [
      'Display-safe card listing (surrogate token, masked PAN, network, status) and per-card detail with expiry (need-to-know only).',
      'Payout account records with presence hints (payoutAccountHasIban); the raw IBAN and routing number are never exposed on this surface.',
    ],
    restrictions: [
      'Never sees the full PAN, CVV, or PIN (SAD is never stored).',
      'Does not manage providers or modules; that is the manager role (separation of duties, PCI DSS Req 7).',
      'Administration is disabled (409 managed_externally) when an external provider takes over the capability.',
    ],
    pci: ['Req 3.2/3.3', 'Req 7', 'Req 10'],
  },
  manager: {
    icon: Database,
    tagline: 'Integration Hub: manage external providers, routing, and credentials.',
    responsibilities: [
      'Configure external provider integrations (fraud, AML, KYC, card auth, etc.).',
      'Manage routing groups, field mapping, and per-provider authentication config.',
      'Monitor integration and process event logs for dispatched calls.',
    ],
    dataAccess: [
      'The integration registry and provider configuration.',
      'Provider API keys are shown once at creation and stored only as a bcrypt hash; never retrievable afterward.',
    ],
    restrictions: [
      'No cardholder PAN decryption.',
      'Provider secrets cannot be read back after creation; only rotated or revoked.',
    ],
    pci: ['Req 8', 'Req 10', 'Req 12'],
  },
};

// Display order for the role reference grids.
export const ROLE_ORDER = ['customer', 'level1_analyst', 'level2_investigator', 'security_auditor', 'merchant_officer', 'operations_officer', 'manager'];

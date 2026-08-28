// Canonical capability registry (ADR-029); frontend mirror of the backend registry.
// Single source of truth for capability labels, admin folders and grouping, replacing the ~11
// scattered hardcoded TYPE_LABEL / TYPE_OPTIONS / PROVIDER_TYPES / CATEGORY_* lists.
//
// `providerType` is the value currently stored in externalProviderArrangementType (bridged until
// the §D6 migration converges it with `capability`).

export type CapabilityKey =
  | 'fds'
  | 'aml'
  | 'hrp'
  | 'kyc'
  | 'credit-bureau'
  | 'kyb'
  | 'card-authorization'
  | 'card-issuer'
  | 'account-information'
  | 'payment-initiation'
  | 'vop'
  | 'generic';

export type ModuleDomain = 'fraud' | 'customer' | 'gateway';

// v37: `hasModule: false` on a capability the BANK owns. Its engine configuration is administered in the
// bank's own app against the bank's own API, so the provider offers no screen for it. This is not the
// capability being absent: routing still resolves it, and the provider still dispatches to whoever serves it.
export interface CapabilityDescriptor {
  capability: CapabilityKey;
  providerType: string;          // legacy externalProviderArrangementType value
  label: string;
  description: string;
  callbackSegment: string;       // /api/v1/providers/callback/<seg>/:id
  frontendFolder: string;        // /system/admin/providers/<folder>
  moduleDomain: ModuleDomain | null;
  hasModule: boolean;
  bianServiceDomain: string;
}

export const CAPABILITIES: Record<CapabilityKey, CapabilityDescriptor> = {
  fds: {
    capability: 'fds', providerType: 'fraud_detection', label: 'Fraud Detection',
    description: 'Real-time transaction fraud scoring (detection).',
    callbackSegment: 'fds', frontendFolder: 'fds', moduleDomain: 'fraud', hasModule: true,
    bianServiceDomain: 'Fraud Evaluation',
  },
  aml: {
    capability: 'aml', providerType: 'aml_monitoring', label: 'AML Monitoring',
    description: 'Anti-money-laundering screening and suspicious-activity analysis.',
    callbackSegment: 'aml', frontendFolder: 'aml', moduleDomain: 'fraud', hasModule: true,
    bianServiceDomain: 'Suspicious Activity Analysis',
  },
  hrp: {
    capability: 'hrp', providerType: 'hrp_sanctions', label: 'HRP / Sanctions',
    description: 'High-risk person/counterparty and sanctions/PEP screening.',
    callbackSegment: 'hrp', frontendFolder: 'hrp', moduleDomain: 'fraud', hasModule: true,
    bianServiceDomain: 'Party Data Management',
  },
  vop: {
    capability: 'vop', providerType: 'vop_verification', label: 'Verification of Payee',
    description: 'Payee name-vs-account confirmation (VoP / UK CoP). Additional to FDS/AML/HRP; market-gated.',
    callbackSegment: 'vop', frontendFolder: 'vop', moduleDomain: 'fraud', hasModule: true,
    bianServiceDomain: 'Party Data Management',
  },
  kyc: {
    capability: 'kyc', providerType: 'kyc_identity', label: 'KYC / Identity',
    description: 'Customer identity verification and due diligence.',
    callbackSegment: 'kyc', frontendFolder: 'kyc', moduleDomain: 'customer', hasModule: true,
    bianServiceDomain: 'Customer Agreement',
  },
  'credit-bureau': {
    capability: 'credit-bureau', providerType: 'credit_bureau', label: 'Credit Bureau',
    description: 'Credit scoring and rating retrieval.',
    callbackSegment: 'credit/bureau', frontendFolder: 'credit-bureau', moduleDomain: 'customer', hasModule: false,
    bianServiceDomain: 'Customer Credit Rating',
  },
  kyb: {
    capability: 'kyb', providerType: 'kyb_business', label: 'KYB / Business',
    description: 'Business/merchant verification and due diligence.',
    callbackSegment: 'kyb', frontendFolder: 'kyb', moduleDomain: 'gateway', hasModule: true,
    bianServiceDomain: 'Merchant Relations',
  },
  'card-authorization': {
    capability: 'card-authorization', providerType: 'card_authorization', label: 'Card Authorization',
    description: 'Authorisation is decided by the institution holding the funds, over its own API. '
      + 'The provider routes the request and records the outcome; it approves nothing itself.',
    callbackSegment: 'card/authorization', frontendFolder: 'card-authorization', moduleDomain: 'gateway', hasModule: false,
    bianServiceDomain: 'Card Authorization',
  },
  'card-issuer': {
    capability: 'card-issuer', providerType: 'card_issuer', label: 'Card Issuer',
    description: 'Card validation and lifecycle belong to the issuing bank, which holds the only copy of '
      + 'the number and derives the verification value. Administered in the bank\'s own app.',
    callbackSegment: 'card/issuer', frontendFolder: 'card-issuer', moduleDomain: 'gateway', hasModule: false,
    bianServiceDomain: 'Payment Card',
  },
  'account-information': {
    capability: 'account-information', providerType: 'account_information', label: 'Account Information (AIS)',
    description: 'Account status and balances are read from the servicing institution under a consent, over '
      + 'the Open Banking account endpoints. The provider stores no balance of its own.',
    callbackSegment: 'account-information', frontendFolder: 'account-information', moduleDomain: 'gateway', hasModule: false,
    bianServiceDomain: 'Open Banking',
  },
  'payment-initiation': {
    capability: 'payment-initiation', providerType: 'payment_initiation', label: 'Payment Initiation (PISP)',
    description: 'A transfer is initiated AT the servicing institution over the Open Banking payment '
      + 'endpoints, which choose the rail from the destination. The provider moves no money itself.',
    callbackSegment: 'payment-initiation', frontendFolder: 'payment-initiation', moduleDomain: 'gateway', hasModule: false,
    bianServiceDomain: 'Payment Execution',
  },
  generic: {
    capability: 'generic', providerType: 'generic', label: 'Merchant Notifications',
    description: 'Generic outbound notifications (e.g. merchant payment callbacks). Passthrough; no internal Module.',
    callbackSegment: 'generic', frontendFolder: 'generic', moduleDomain : null, hasModule: false,
    bianServiceDomain: 'External Provider Arrangements',
  },
};

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as CapabilityKey[];
export const CAPABILITY_LIST: CapabilityDescriptor[] = CAPABILITY_KEYS.map((k) => CAPABILITIES[k]);

export function byCapability(key: CapabilityKey): CapabilityDescriptor {
  return CAPABILITIES[key];
}
export function byProviderType(type: string): CapabilityDescriptor | undefined {
  return CAPABILITY_LIST.find((c) => c.providerType === type);
}
export function isCapabilityKey(value: string): value is CapabilityKey {
  return value in CAPABILITIES;
}
export function capabilitiesWithModule(): CapabilityDescriptor[] {
  return CAPABILITY_LIST.filter((c) => c.hasModule);
}

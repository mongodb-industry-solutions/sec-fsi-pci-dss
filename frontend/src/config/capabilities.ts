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
    callbackSegment: 'credit/bureau', frontendFolder: 'credit-bureau', moduleDomain: 'customer', hasModule: true,
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
    description: 'Card authorization request/response (no CVV passed; PCI DSS Req 3.3).',
    callbackSegment: 'card/authorization', frontendFolder: 'card-authorization', moduleDomain: 'gateway', hasModule: true,
    bianServiceDomain: 'Card Authorization',
  },
  'card-issuer': {
    capability: 'card-issuer', providerType: 'card_issuer', label: 'Card Issuer',
    description: 'CVV/PIN validation and card lifecycle (activate/block/replace).',
    callbackSegment: 'card/issuer', frontendFolder: 'card-issuer', moduleDomain: 'gateway', hasModule: true,
    bianServiceDomain: 'Payment Card',
  },
  'account-information': {
    capability: 'account-information', providerType: 'account_information', label: 'Account Information (AIS)',
    description: 'Validates payout account status and retrieves internal ledger balance (PSD2 AIS). IBAN never exposed on the wire, resolved by the adapter from the QE vault.',
    callbackSegment: 'account-information', frontendFolder: 'account-information', moduleDomain: 'gateway', hasModule: true,
    bianServiceDomain: 'Open Banking',
  },
  'payment-initiation': {
    capability: 'payment-initiation', providerType: 'payment_initiation', label: 'Payment Initiation (PISP)',
    description: 'Initiates bank transfers over SEPA / ACH / internal rails with configurable T+N settlement delays (PSD2 PISP). Amount and PSP account ref only, no IBAN on the wire.',
    callbackSegment: 'payment-initiation', frontendFolder: 'payment-initiation', moduleDomain: 'gateway', hasModule: true,
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

// Canonical capability registry (ADR-029) — the single source of truth for the nine PSP
// capabilities. Each capability is one business axis with two views: external **Providers**
// (Vendors) and an internal **Module** (engine). This descriptor maps the canonical kebab key to
// its current stored provider type, owning Module domain, routing segments and BIAN/PCI metadata,
// so capability metadata is defined exactly once instead of in ~11 scattered hardcoded lists.
//
// During the v8 migration `providerType` still holds the legacy enum value stored in
// `externalProviderArrangementType`; the registry bridges legacy value ↔ canonical key. Once the
// stored values are migrated (plan §D6), `providerType` and `capability` converge.

import type { IntegrationProviderType } from '../models/externalProviderArrangement.model';

export type CapabilityKey =
  | 'fds'
  | 'aml'
  | 'hrp'
  | 'kyc'
  | 'credit-bureau'
  | 'kyb'
  | 'card-authorization'
  | 'card-issuer'
  | 'generic';

// Code module that physically owns the capability's internal engine (engine grouped by capability
// in config/UX, implemented inside the domain module that already owns its data).
export type ModuleDomain = 'fraud' | 'customer' | 'gateway';

export interface CapabilityDescriptor {
  capability: CapabilityKey;
  /** Legacy value stored in externalProviderArrangementType (bridged until §D6 migration). */
  providerType: IntegrationProviderType;
  label: string;
  description: string;
  /** Path segment under /api/v1/providers/callback/<callbackSegment>/:id (may be multi-segment). */
  callbackSegment: string;
  /** Folder under /system/admin/providers/<frontendFolder>. */
  frontendFolder: string;
  /** Owning domain module for the internal Module engine; null = no Module (passthrough). */
  moduleDomain: ModuleDomain | null;
  hasModule: boolean;
  bianServiceDomain: string;
  bianControlRecordType: string;
  pciDssRequirements: string[];
}

export const CAPABILITIES: Record<CapabilityKey, CapabilityDescriptor> = {
  fds: {
    capability: 'fds',
    providerType: 'fraud_detection',
    label: 'Fraud Detection',
    description: 'Real-time transaction fraud scoring (detection). Distinct from Fraud Diagnosis (SD-83) case investigation.',
    callbackSegment: 'fds',
    frontendFolder: 'fds',
    moduleDomain: 'fraud',
    hasModule: true,
    bianServiceDomain: 'SD-63 Fraud Evaluation',
    bianControlRecordType: 'FraudEvaluationAssessment',
    pciDssRequirements: ['Req 10.2.1', 'Req 12.3.1', 'Req 12.8.1'],
  },
  aml: {
    capability: 'aml',
    providerType: 'aml_monitoring',
    label: 'AML Monitoring',
    description: 'Anti-money-laundering screening and suspicious-activity analysis.',
    callbackSegment: 'aml',
    frontendFolder: 'aml',
    moduleDomain: 'fraud',
    hasModule: true,
    bianServiceDomain: 'SD-99 Suspicious Activity Analysis',
    bianControlRecordType: 'SuspiciousActivityAnalysisAssessment',
    pciDssRequirements: ['Req 10.2.1', 'Req 12.3.1', 'Req 12.8.1'],
  },
  hrp: {
    capability: 'hrp',
    providerType: 'hrp_sanctions',
    label: 'HRP / Sanctions',
    description: 'High-risk person/counterparty and sanctions/PEP screening.',
    callbackSegment: 'hrp',
    frontendFolder: 'hrp',
    moduleDomain: 'fraud',
    hasModule: true,
    bianServiceDomain: 'SD-13 Party Data Management',
    bianControlRecordType: 'PartyReferenceDataDirectoryEntry',
    pciDssRequirements: ['Req 12.8.1', 'Req 12.8.5'],
  },
  kyc: {
    capability: 'kyc',
    providerType: 'kyc_identity',
    label: 'KYC / Identity',
    description: 'Customer identity verification and due diligence.',
    callbackSegment: 'kyc',
    frontendFolder: 'kyc',
    moduleDomain: 'customer',
    hasModule: true,
    bianServiceDomain: 'SD-53 Customer Agreement',
    bianControlRecordType: 'CustomerAgreementProcedure',
    pciDssRequirements: ['Req 8.1', 'Req 12.8.1'],
  },
  'credit-bureau': {
    capability: 'credit-bureau',
    providerType: 'credit_bureau',
    label: 'Credit Bureau',
    description: 'Credit scoring and rating retrieval.',
    callbackSegment: 'credit/bureau',
    frontendFolder: 'credit-bureau',
    moduleDomain: 'customer',
    hasModule: true,
    bianServiceDomain: 'SD-60 Customer Credit Rating',
    bianControlRecordType: 'CustomerCreditRatingState',
    pciDssRequirements: ['Req 12.8.1'],
  },
  kyb: {
    capability: 'kyb',
    providerType: 'kyb_business',
    label: 'KYB / Business',
    description: 'Business/merchant verification and due diligence.',
    callbackSegment: 'kyb',
    frontendFolder: 'kyb',
    moduleDomain: 'gateway',
    hasModule: true,
    bianServiceDomain: 'SD-89 Merchant Relations',
    bianControlRecordType: 'MerchantAgreementProcedure',
    pciDssRequirements: ['Req 12.8.1', 'Req 12.8.3'],
  },
  'card-authorization': {
    capability: 'card-authorization',
    providerType: 'card_authorization',
    label: 'Card Authorization',
    description: 'Card authorization request/response (no CVV passed — PCI DSS Req 3.3).',
    callbackSegment: 'card/authorization',
    frontendFolder: 'card-authorization',
    moduleDomain: 'gateway',
    hasModule: true,
    bianServiceDomain: 'SD-15 Card Authorization', // confirm vs technical-spec §9 before Phase 2 seed
    bianControlRecordType: 'CardAuthorizationRecord',
    pciDssRequirements: ['Req 3.3', 'Req 12.8.1'],
  },
  'card-issuer': {
    capability: 'card-issuer',
    providerType: 'card_issuer',
    label: 'Card Issuer',
    description: 'CVV/PIN validation and card lifecycle (activate/block/replace).',
    callbackSegment: 'card/issuer',
    frontendFolder: 'card-issuer',
    moduleDomain: 'gateway',
    hasModule: true,
    bianServiceDomain: 'SD-88 Payment Card', // confirm vs technical-spec §9 before Phase 2 seed
    bianControlRecordType: 'PaymentCardManagement',
    pciDssRequirements: ['Req 3.2', 'Req 3.3', 'Req 12.8.1'],
  },
  generic: {
    capability: 'generic',
    providerType: 'generic',
    label: 'Merchant Notifications',
    description: 'Generic outbound notifications (e.g. merchant payment callbacks). Passthrough — no internal Module.',
    callbackSegment: 'generic',
    frontendFolder: 'generic',
    moduleDomain: null,
    hasModule: false,
    bianServiceDomain: 'SD-193 External Provider Arrangements',
    bianControlRecordType: 'ExternalProviderArrangementPortfolio',
    pciDssRequirements: ['Req 12.8.1'],
  },
};

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as CapabilityKey[];

export const CAPABILITY_LIST: CapabilityDescriptor[] = CAPABILITY_KEYS.map((k) => CAPABILITIES[k]);

export function byCapability(key: CapabilityKey): CapabilityDescriptor {
  return CAPABILITIES[key];
}

/** Bridge a legacy stored provider type to its capability descriptor. */
export function byProviderType(type: IntegrationProviderType): CapabilityDescriptor | undefined {
  return CAPABILITY_LIST.find((c) => c.providerType === type);
}

export function isCapabilityKey(value: string): value is CapabilityKey {
  return value in CAPABILITIES;
}

/** Capabilities that have an internal Module engine (all except `generic`). */
export function capabilitiesWithModule(): CapabilityDescriptor[] {
  return CAPABILITY_LIST.filter((c) => c.hasModule);
}

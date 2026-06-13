export const INTEGRATION_REGISTRY_COLLECTION        = 'integrationRegistry';
export const INTEGRATION_EVENTS_COLLECTION          = 'integrationEvents';
export const INTEGRATION_ROUTING_GROUPS_COLLECTION  = 'integrationRoutingGroups';
export const BUSINESS_PROCESS_EVENTS_COLLECTION     = 'businessProcessEvent';
export const COMPLIANCE_PROCESS_EVENTS_COLLECTION   = 'complianceProcessEvent';

// ── Core enumerations ─────────────────────────────────────────────────────────

export type IntegrationProviderType =
  | 'fraud_detection'
  | 'aml_monitoring'
  | 'kyc_identity'
  | 'kyb_business'
  | 'hrp_sanctions'
  | 'credit_bureau'
  | 'card_authorization'
  | 'card_issuer'
  | 'generic';

export type IntegrationStatus  = 'active' | 'inactive' | 'test' | 'suspended';
export type IntegrationMode    = 'sync' | 'async';
export type IntegrationAuth    = 'bearer' | 'api_key' | 'hmac' | 'oauth2_cc';
export type IntegrationHealth  = 'ok' | 'degraded' | 'unreachable' | 'unknown';
export type RoutingStrategy    = 'primary_fallback' | 'round_robin' | 'weighted' | 'parallel';

// ── Field Mapping ─────────────────────────────────────────────────────────────

export type FieldTransformType =
  | 'rename'
  | 'value_map'
  | 'scale'
  | 'nested_extract'
  | 'nested_wrap';

export interface FieldTransform {
  type: FieldTransformType;
  scaleFactor?: number;
  valueMap?: Record<string, string>;
  wrapPath?: string;
}

export interface FieldMapping {
  sourcePath: string;
  targetPath: string;
  transform?: FieldTransform;
  required?: boolean;
  defaultValue?: unknown;
}

export interface FieldMappingConfig {
  outbound: FieldMapping[];
  inbound: FieldMapping[];
  schemaVersion: number;
}

// ── Authentication Configuration ──────────────────────────────────────────────

export interface BearerAuthConfig {
  tokenHeaderName: string;
  tokenPrefix: string;
  tokenExpiresAt?: string;
}

export interface ApiKeyAuthConfig {
  keyHeaderName: string;
  keyLocation: 'header' | 'query' | 'body';
  keyParamName?: string;
  keyPrefix?: string;
}

export interface HmacOutboundConfig {
  algorithm: 'sha256' | 'sha512';
  signatureHeaderName: string;
  signaturePrefix: string;
  payloadFormat: 'hex' | 'base64';
  includeTimestamp: boolean;
  timestampHeaderName?: string;
}

export interface HmacInboundConfig {
  algorithm: 'sha256' | 'sha512';
  signatureHeaderName: string;
  signaturePrefix: string;
  payloadFormat: 'hex' | 'base64';
  replayWindowSeconds: number;
}

export interface OAuth2Config {
  clientId: string;
  clientSecretPlaintext?: string; // Demo only — production: AWS Secrets Manager
  tokenEndpoint: string;
  scopes: string[];
  tokenCachingEnabled: boolean;
}

export interface IntegrationAuthConfig {
  scheme: IntegrationAuth;
  bearer?: BearerAuthConfig;
  apiKey?: ApiKeyAuthConfig;
  hmacOutbound?: HmacOutboundConfig;
  hmacInbound?: HmacInboundConfig;
  oauth2?: OAuth2Config;
}

// ── Category-Specific Configuration ──────────────────────────────────────────

export interface FraudDetectionConfig {
  scoreThresholds: { low: number; medium: number };
  scoreField: string;
  recommendationField: string;
  realTimeRequired: boolean;
  batchSupported: boolean;
  modelVersion?: string;
  scoreScaleMax: number;
}

export interface AmlMonitoringConfig {
  screeningTypes: ('customer_onboarding' | 'transaction' | 'batch_periodic')[];
  watchlistSources: string[];
  jurisdictions: string[];
  sarThreshold?: number;
  sarCurrency?: string;
  continuousMonitoring: boolean;
  batchSchedule?: string;
  alertSeverityLevels: string[];
}

export interface KycIdentityConfig {
  verificationLevels: ('basic' | 'enhanced' | 'full')[];
  defaultLevel: 'basic' | 'enhanced' | 'full';
  documentTypesAccepted: string[];
  livenessCheckRequired: boolean;
  biometricSupported: boolean;
  reVerificationDays: number;
  dataRetentionDays: number;
  consentRequired: boolean;
}

export interface KybBusinessConfig {
  uboDisclosureThreshold: number;
  businessTypesSupported: string[];
  registrationCountries: string[];
  dueDiligenceLevel: 'standard' | 'enhanced' | 'extreme';
  renewalDays: number;
  pepScreeningIncluded: boolean;
  adverseMediaScreening: boolean;
}

export interface HrpSanctionsConfig {
  screeningLists: string[];
  matchThreshold: number;
  screeningDimensions: string[];
  realTimeScreening: boolean;
  batchRescreeningSchedule?: string;
  hitDispositionRequired: boolean;
  autoApproveBelow?: number;
}

export interface CreditBureauConfig {
  bureauName: string;
  bureauRegion: string;
  pullTypes: ('soft' | 'hard')[];
  defaultPullType: 'soft' | 'hard';
  scoringModel?: string;
  scoreRangeMin: number;
  scoreRangeMax: number;
  consentRequired: boolean;
  refreshFrequencyDays: number;
  jurisdictions: string[];
}

export interface CardAuthorizationConfig {
  merchantCode: string;
  terminalNumber?: string;
  signatureVersion: 'HMAC_SHA256' | 'HMAC_SHA512_V2';
  enableThreeDS: boolean;
  mockMode: boolean;
  simulatorMode: 'always_approve' | 'scenario_driven';
}

export interface CardIssuerConfig {
  issuerBin?: string;
  cardNetworks: ('visa' | 'mastercard' | 'amex' | 'discover')[];
  cvvValidationEnabled: boolean;
  pinValidationEnabled: boolean;
  mockMode: boolean;
  pinBlockFormat: 'ISO-0' | 'ISO-3' | 'ISO-4';
}

export interface GenericIntegrationConfig {
  categoryLabel: string;
  customEventTypes: string[];
  description?: string;
  tags?: string[];
}

export type CategoryConfig =
  | FraudDetectionConfig
  | AmlMonitoringConfig
  | KycIdentityConfig
  | KybBusinessConfig
  | HrpSanctionsConfig
  | CreditBureauConfig
  | CardAuthorizationConfig
  | CardIssuerConfig
  | GenericIntegrationConfig;

// ── Routing Groups ────────────────────────────────────────────────────────────

export interface RoutingGroupMember {
  externalProviderArrangementInstanceReference: string;
  memberPriority: number;
  memberWeight?: number;
  memberRole?: 'primary' | 'fallback' | 'peer';
}

export interface IntegrationRoutingGroup {
  routingGroupInstanceReference: string;
  routingGroupName: string;
  routingGroupProviderType: IntegrationProviderType;
  routingGroupStrategy: RoutingStrategy;
  routingGroupStatus: 'active' | 'inactive';
  routingGroupMembers: RoutingGroupMember[];
  isDefaultGroup: boolean;
  bianServiceDomain: string;
  bianControlRecordType: string;
  pciDssRequirements: string[];
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}

// ── Core Provider Model ───────────────────────────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface ExternalProviderArrangement {
  externalProviderArrangementInstanceReference: string;
  externalProviderArrangementName: string;
  externalProviderArrangementType: IntegrationProviderType;
  externalProviderArrangementStatus: IntegrationStatus;

  externalProviderIsInternal: boolean;
  externalProviderInternalHandler?: string;

  externalProviderApiEndpoint?: string;
  externalProviderApiKeyHash?: string;       // bcrypt — never returned
  externalProviderApiKeyPrefix?: string;
  externalProviderAuthScheme?: IntegrationAuth;

  externalProviderCallbackEnabled: boolean;
  externalProviderCallbackPath?: string;
  externalProviderCallbackSecretHash?: string; // bcrypt — never returned

  externalProviderTriggerEvents: string[];
  externalProviderMode: IntegrationMode;

  externalProviderTimeoutMs: number;
  externalProviderRetryPolicy: RetryPolicy;

  externalProviderLastHealthCheckAt?: Date;
  externalProviderHealthStatus?: IntegrationHealth;

  // Enhanced configuration (v2)
  categoryConfig?: CategoryConfig;
  authConfig?: IntegrationAuthConfig;
  fieldMappingConfig?: FieldMappingConfig;

  // Multi-provider routing
  routingGroupId?: string;
  routingPriority?: number;
  routingWeight?: number;

  bianServiceDomain: string;
  bianControlRecordType: string;
  pciDssRequirements: string[];

  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

// ── Business Context Correlation (ADR-025) ────────────────────────────────────

export type BusinessEntityType = 'transaction' | 'fraud_case' | 'customer' | 'merchant' | 'payment_link' | 'card';

export type BusinessProcessType =
  | 'payment_processing'
  | 'fraud_evaluation'
  | 'aml_screening'
  | 'card_authorization'
  | 'credit_assessment'
  | 'sanctions_check'
  | 'checkout';

export type ComplianceProcessType =
  | 'kyc_verification'
  | 'kyb_verification'
  | 'merchant_onboarding'
  | 'customer_onboarding';

export type ProcessEventOutcome = 'approved' | 'rejected' | 'pending' | 'failed' | 'escalated';

export interface BusinessContextRef {
  entityType: BusinessEntityType;
  entityId: string;
  processType: BusinessProcessType | ComplianceProcessType;
}

export interface ProcessEventMeta {
  integrationEventRefs?: string[];
  ruleIds?: string[];
  thresholds?: Record<string, number>;
  [key: string]: unknown;
}

export interface BusinessProcessEvent {
  eventDateTime: Date;
  processType: BusinessProcessType | ComplianceProcessType;
  businessProcessEventInstanceReference: string;
  entityType: BusinessEntityType;
  entityId: string;
  processAction: string;
  processOutcome: ProcessEventOutcome;
  performedByPartyReference: string | null;
  performedByRole: string | null;
  eventSummary: Record<string, unknown>;
  bianServiceDomain: string;
  bianControlRecordType: string;
  processMeta?: ProcessEventMeta;
}

// ── Typed Payload Contracts per Integration Category (ADR-025) ────────────────

export interface FdsOutboundPayload {
  transactionInstanceReference: string;
  transactionAmount: number;
  transactionCurrency: string;
  transactionChannel: string;
  deviceFingerprint?: string;
  ipAddress?: string;
}
export interface FdsInboundPayload {
  riskScore: number;
  fraudFlag: boolean;
  recommendation: 'approve' | 'review' | 'decline';
  rulesFired?: string[];
}

export interface AmlOutboundPayload {
  partyInstanceReference: string;
  transactionInstanceReference: string;
  transactionAmount: number;
  transactionCurrency: string;
  counterpartyReference?: string;
}
export interface AmlInboundPayload {
  alertLevel: 'none' | 'low' | 'medium' | 'high';
  matchedPatterns?: string[];
  requiresReview: boolean;
}

export interface KycOutboundPayload {
  partyInstanceReference: string;
  partyName: string;
  partyDateOfBirth?: string;
  partyNationality?: string;
  documentType?: string;
}
export interface KycInboundPayload {
  verificationStatus: 'pass' | 'fail' | 'manual_review';
  confidenceScore: number;
  failureReasons?: string[];
}

export interface KybOutboundPayload {
  merchantAgreementInstanceReference: string;
  merchantName: string;
  merchantLegalEntityType?: string;
  merchantRegistrationNumber?: string;
  merchantCountry?: string;
}
export interface KybInboundPayload {
  verificationStatus: 'pass' | 'fail' | 'manual_review';
  businessRiskLevel: 'low' | 'medium' | 'high';
  sanctionsMatch: boolean;
  failureReasons?: string[];
}

export interface HrpOutboundPayload {
  partyInstanceReference: string;
  partyName: string;
  transactionCountry?: string;
  transactionAmount?: number;
}
export interface HrpInboundPayload {
  sanctionsHit: boolean;
  pepHit: boolean;
  matchedLists?: string[];
  riskRating: 'low' | 'medium' | 'high' | 'blocked';
}

export interface CreditBureauOutboundPayload {
  partyInstanceReference: string;
  partyName: string;
  requestedCreditAmount?: number;
}
export interface CreditBureauInboundPayload {
  creditScore: number;
  creditRating: string;
  defaultProbability: number;
}

export interface CardAuthOutboundPayload {
  cardTransactionInstanceReference: string;
  transactionAmount: number;
  transactionCurrency: string;
  merchantCategoryCode?: string;
  transactionChannel: string;
}
export interface CardAuthInboundPayload {
  authorizationCode: string;
  authorizationStatus: 'approved' | 'declined' | 'referral';
  responseCode: string;
  declineReason?: string;
}

export interface CardIssuerOutboundPayload {
  paymentCardInstanceReference: string;
  requestType: 'activate' | 'block' | 'replace' | 'status_check';
  reason?: string;
}
export interface CardIssuerInboundPayload {
  cardStatus: 'active' | 'blocked' | 'expired' | 'replaced';
  actionConfirmed: boolean;
  effectiveDateTime?: string;
}

export interface GenericOutboundPayload {
  eventType: string;
  entityReference: string;
  payload: Record<string, unknown>;
}
export interface GenericInboundPayload {
  status: 'ok' | 'error';
  result?: Record<string, unknown>;
  errorMessage?: string;
}

// ── Event Model ───────────────────────────────────────────────────────────────

export interface IntegrationEvent {
  integrationEventInstanceReference: string;
  externalProviderArrangementInstanceReference: string;
  integrationEventType: 'dispatch' | 'callback' | 'health_check' | 'test';
  integrationEventStatus: 'sent' | 'received' | 'error' | 'timeout';
  integrationEventPayloadHash?: string;
  integrationEventResponseCode?: number;
  integrationEventLatencyMs?: number;
  integrationEventErrorMessage?: string;
  integrationEventTriggeredBy: string;
  integrationEventMeta?: Record<string, unknown>;
  businessContext?: BusinessContextRef;
  bianServiceDomain: string;
  bianControlRecordType: string;
  recordCreatedDateTime: Date;
}

// Strip sensitive hashes from API responses
export type IntegrationSummary = Omit<
  ExternalProviderArrangement,
  'externalProviderApiKeyHash' | 'externalProviderCallbackSecretHash'
>;

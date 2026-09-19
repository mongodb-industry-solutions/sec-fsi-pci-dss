import type { PlatformEnvironment } from '@leafypay/platform-links';

// Collection names migrated to pure control records (dev.v7 plan, Fase 2). The constant
// IDENTIFIERS keep their INTEGRATION_* names until the module rename in Fase 3, only the stored
// collection VALUES change here, so no importer needs touching and the DB is BIAN-clean.
export const EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION        = 'externalProviderArrangement';
export const EXTERNAL_PROVIDER_ARRANGEMENT_ACTION_LOG_COLLECTION          = 'externalProviderArrangementActionLog';
export const EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION  = 'externalProviderArrangementPortfolio';
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
  | 'account_information'    // Open Banking AIS: external bank account identity/balance (PSD2)
  | 'payment_initiation'     // PISP: executes bank transfers (PSD2)
  | 'currency_exchange'      // v17 FX: converts amounts between ISO-4217 currencies (mid rate + spread)
  | 'vop_verification'       // v28 Verification of Payee: name-vs-account confirmation (EPC VoP / UK CoP)
  | 'aspsp'                  // v37: the institution that HOLDS the account, as distinct from reading it (AIS)
                             // or initiating from it (PIS). Its ledger is the authoritative balance.
  | 'generic';

export type IntegrationStatus  = 'active' | 'inactive' | 'test' | 'suspended';
export type IntegrationMode    = 'sync' | 'async';
export type IntegrationAuth    = 'bearer' | 'api_key' | 'hmac' | 'oauth2_cc';
export type IntegrationHealth  = 'ok' | 'degraded' | 'unreachable' | 'unknown';

/**
 * A provider's base URL in each environment, indexed by the environment's own id.
 *
 * The key is the value `PSP_ENVIRONMENT` carries (`development`, `staging`, `production`), so the
 * entry is selected with no mapping in between. The value is an absolute URL, or the name of a
 * platform link when the provider is a platform service whose addresses are declared centrally.
 *
 * Partial on purpose: a provider that does not exist in one environment has no entry for it, and
 * that must read as "not configured here" rather than as an empty address.
 */
export type ProviderBaseUrlByEnvironment = Partial<Record<PlatformEnvironment, string>>;
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
  clientSecretPlaintext?: string; // Demo only, production: AWS Secrets Manager
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

// ── Per-event wire configuration (§2.4 / §7.7) ────────────────────────────────
// Each event a vendor handles has its OWN outbound + inbound config, including its own URLs. URLs,
// mapping, auth, retries and timeout are NEVER vendor-global, always per event. There is no vendor
// base URL. The inbound callback is per event+vendor (§7.7).
export interface ProviderEventOutboundConfig {
  url?: string;                          // outbound PATH the PSP calls for THIS event
  /**
   * This route's host in each environment, overriding the provider-level map.
   *
   * Absent means "the provider's own address", which is the normal case: a bank serves every one of
   * its operations on one host. It exists for the provider that does not, such as a vendor whose
   * sandbox sits on a different domain from the operation being configured, and so that the screen
   * where a URL is set can always show the path and its per-environment hosts together.
   */
  baseUrlByEnvironment?: ProviderBaseUrlByEnvironment;
  httpMethod?: 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE';
  // v37 P6.2d: declared headers, templated from the payload the same way the url is. Berlin Group carries
  // the consent in `Consent-ID` and the trace in `X-Request-ID`, so a standard bank API cannot be driven by
  // configuration alone without this: the path templating got the request to the bank and it refused for a
  // missing header, which is how this gap was found.
  headers?: Record<string, string>;
  mapping?: FieldMapping[];              // outbound attribute mapping for this event
  auth?: IntegrationAuthConfig;          // per-event auth (e.g. API key / bearer / hmacOutbound)
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
}
export interface ProviderEventInboundConfig {
  callbackUrl?: string;                  // inbound callback PATH (or absolute URL) the vendor calls (§7.7)
  /**
   * The host the provider is told to call back on, per environment.
   *
   * This side is OURS, not theirs: it is the address at which this platform receives. It matters for
   * the same reason the outbound side does and slightly more, because it is a value handed to an
   * external system, so getting it wrong means a provider holding an address that stops existing
   * the moment the environment changes. Absent means the `{{psp}}` link.
   */
  baseUrlByEnvironment?: ProviderBaseUrlByEnvironment;
  mapping?: FieldMapping[];              // inbound attribute mapping for this event
  auth?: IntegrationAuthConfig;          // per-event inbound auth (e.g. hmacInbound, anti-spoofing)
  referenceLocation?: 'body' | 'header'; // where clientReference (= correlationId) travels (§7.7)
  referenceField?: string;               // body path or header name carrying the reference
}
export interface ProviderEventConfig {
  event: string;                         // bus event handled, e.g. 'card.issuer.validation.requested'
  outbound: ProviderEventOutboundConfig;
  inbound: ProviderEventInboundConfig;
}

export interface ExternalProviderArrangement {
  externalProviderArrangementInstanceReference: string;
  externalProviderArrangementName: string;
  externalProviderArrangementType: IntegrationProviderType;
  externalProviderArrangementStatus: IntegrationStatus;

  externalProviderIsInternal: boolean;
  externalProviderInternalHandler?: string;

  externalProviderApiEndpoint?: string;
  externalProviderApiKeyHash?: string;       // bcrypt, never returned
  externalProviderApiKeyPrefix?: string;
  externalProviderAuthScheme?: IntegrationAuth;
  // Base URL of a provider whose API is a REST RESOURCE api rather than a single endpoint (v37).
  // `externalProviderApiEndpoint` stays the one-endpoint dispatch target the Hub posts to; a provider like
  // an ASPSP has a path and a method per operation, so its adapter needs the host and builds the rest.
  //
  // Holds either an absolute URL or the NAME of a platform link (`{{bankcore}}`), bound to this
  // environment when the call is made. The fallback for a provider that answers on one address
  // everywhere; a provider that does not declares the list below instead.
  externalProviderBaseUrl?: string;
  /**
   * The provider's address in EVERY environment, declared once, indexed by environment id.
   *
   *     { development: 'http://localhost:8083', staging: 'https://bank-api.staging.example/' }
   *
   * This is what makes one registration work in all of them: the deployment names itself through
   * `PSP_ENVIRONMENT` and the matching entry is the base URL, so promoting local to staging to
   * production is one variable rather than a re-seed or a hand edit. A third-party provider with a
   * sandbox host and a production host is the same case as the bank with a loopback and an in-cluster
   * name, and both are declared here.
   *
   * Takes precedence over `externalProviderBaseUrl` when it has an entry for the current environment,
   * and each entry may itself be a platform link name so a platform service is declared in one place.
   */
  externalProviderBaseUrlByEnvironment?: ProviderBaseUrlByEnvironment;
  // v37 P6.3: what this provider SERVES, which is what an entity-bound capability resolves on. A linked
  // account or a registered card names its institution directly; a freshly typed IBAN or PAN is matched
  // against these declared identifiers instead. Seeded data, so a second bank is a record.
  externalProviderAspspReference?: string;
  externalProviderIbanBankCodes?: string[];
  externalProviderBinRanges?: Array<{ binRangeFrom: string; binRangeTo: string }>;

  externalProviderCallbackEnabled: boolean;
  externalProviderCallbackPath?: string;
  externalProviderCallbackSecretHash?: string; // bcrypt, never returned

  externalProviderTriggerEvents: string[];
  // §2.4: per-event wire config, the AUTHORITATIVE source for url/method/mapping/auth/retries/timeout
  // and the inbound callback. The seeder populates it for every vendor (deriveEventConfigs), the
  // dispatcher (resolveEventOutbound) and the callback handlers (resolveEventInbound) read it, and the
  // admin Outbound/Inbound tabs edit it. The vendor-global fields below are a DEPRECATED migration
  // fallback only (no vendor base URL per §2.4); they are never the source of truth when per-event
  // config is present (always, post-seed) and exist solely as a safety net for legacy/partial data.
  externalProviderEvents?: ProviderEventConfig[];
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

// v32: 'beneficiary' added for CounterpartyArrangement, so a per-record beneficiary
// disclosure can be attributed to its own control record (PCI DSS names the affected data).
export type BusinessEntityType = 'transaction' | 'p2p_transfer' | 'fraud_case' | 'customer' | 'merchant' | 'payment_link' | 'card' | 'execution' | 'account' | 'payment_request' | 'beneficiary';

export type BusinessProcessType =
  | 'payment_processing'
  | 'fraud_evaluation'
  | 'aml_screening'
  | 'card_authorization'
  | 'credit_assessment'
  | 'sanctions_check'
  | 'consent_management'   // v18: OAuth consent grant/update/reuse audit 
  | 'checkout';

export type ComplianceProcessType =
  | 'kyc_verification'
  | 'kyb_verification'
  | 'merchant_onboarding'
  | 'customer_onboarding'
  | 'card_management'       // stored-card lifecycle (register / remove): PCI DSS
  | 'payment_processing'    // payout execution + AIS/PISP audit trail (v17)
  | 'authentication';       // CIBA + passwordless enrollment audit trail (PCI DSS)

export type ProcessEventOutcome = 'approved' | 'rejected' | 'pending' | 'failed' | 'escalated'
  | 'in_flight' | 'settled' | 'verified' | 'submitted'; // payout execution outcomes (v17)

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
  // v18 (audit attribution): optional, backwards-compatible. Populated when an action originates
  // from a merchant OAuth-authenticated request (request.merchantContext). Enables the "user × merchant
  // × action" activity view without a new collection.
  clientId?: string;                    // OAuth client_id that originated the action
  merchantAgreementReference?: string;  // merchant the action was performed through
  actingPartyReference?: string;        // OAuth subject of the acting user (token.sub = customerAuthenticationInstanceReference, NOT an Party ref); matched as such in businessProcessEvent joins
  actingChannel?: 'session' | 'oauth_merchant';
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
  // Sanitized snapshot of the payload (CHD stripped, PCI DSS) so the audit view can
  // show exactly what data was sent/received and support analysis or event reproduction.
  integrationEventPayloadSnapshot?: Record<string, unknown>;
  integrationEventResponseCode?: number;
  integrationEventLatencyMs?: number;
  integrationEventErrorMessage?: string;
  integrationEventTriggeredBy: string;
  integrationEventMeta?: Record<string, unknown>;
  // Full request/response capture for outbound dispatch and inbound callbacks (PCI DSS,
  // reconstruct what happened). Sanitized: auth/CHD values are redacted before storage.
  integrationEventRequest?: { method: string; url?: string; headers?: Record<string, string>; body?: unknown };
  integrationEventResponse?: { status?: number; headers?: Record<string, string>; body?: unknown };
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

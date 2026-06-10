export const INTEGRATION_REGISTRY_COLLECTION = 'integrationRegistry';
export const INTEGRATION_EVENTS_COLLECTION   = 'integrationEvents';

export type IntegrationProviderType =
  | 'fraud_detection'
  | 'aml_monitoring'
  | 'kyc_identity'
  | 'kyb_business'
  | 'hrp_sanctions'
  | 'credit_bureau';

export type IntegrationStatus  = 'active' | 'inactive' | 'test' | 'suspended';
export type IntegrationMode    = 'sync' | 'async';
export type IntegrationAuth    = 'bearer' | 'api_key' | 'hmac' | 'oauth2_cc';
export type IntegrationHealth  = 'ok' | 'degraded' | 'unreachable' | 'unknown';

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

  bianServiceDomain: string;
  bianControlRecordType: string;
  pciDssRequirements: string[];

  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

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
  bianServiceDomain: string;
  bianControlRecordType: string;
  recordCreatedDateTime: Date;
}

export type IntegrationSummary = Omit<
  ExternalProviderArrangement,
  'externalProviderApiKeyHash' | 'externalProviderCallbackSecretHash'
>;

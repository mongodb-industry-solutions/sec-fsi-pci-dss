// §2.4 / §7.7 per-event config resolver. Each event a vendor handles has its OWN outbound + inbound
// wire config. This resolver returns the EFFECTIVE config for a (vendor, event): it prefers the
// per-event entry and falls back to the vendor-global fields during migration (removed in P11f).
import {
  ExternalProviderArrangement,
  ProviderEventConfig,
  ProviderEventOutboundConfig,
  ProviderEventInboundConfig,
  FieldMapping,
  IntegrationAuthConfig,
  RetryPolicy,
} from '../models/externalProviderArrangement.model';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 1, backoffMs: 0 };
const DEFAULT_HTTP_METHOD = 'POST';
const DEFAULT_REFERENCE_FIELD = 'clientReference'; // = correlationId echoed on the wire (§7.7)

export interface ResolvedOutbound {
  url?: string;
  httpMethod: string;
  mapping: FieldMapping[];
  auth?: IntegrationAuthConfig;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
  perEvent: boolean; // true when a per-event entry supplied the values (vs vendor-global fallback)
}

export interface ResolvedInbound {
  callbackUrl?: string;
  mapping: FieldMapping[];
  auth?: IntegrationAuthConfig;
  referenceLocation: 'body' | 'header';
  referenceField: string;
  perEvent: boolean;
}

function findEvent(vendor: ExternalProviderArrangement, event: string): ProviderEventConfig | undefined {
  return vendor.externalProviderEvents?.find((e) => e.event === event);
}

/** Effective OUTBOUND config for a (vendor, event): per-event overrides vendor-global. */
export function resolveEventOutbound(vendor: ExternalProviderArrangement, event: string): ResolvedOutbound {
  const ev = findEvent(vendor, event)?.outbound;
  return {
    url: ev?.url ?? vendor.externalProviderApiEndpoint,
    httpMethod: ev?.httpMethod ?? DEFAULT_HTTP_METHOD,
    mapping: ev?.mapping ?? vendor.fieldMappingConfig?.outbound ?? [],
    auth: ev?.auth ?? vendor.authConfig,
    retryPolicy: ev?.retryPolicy ?? vendor.externalProviderRetryPolicy ?? DEFAULT_RETRY,
    timeoutMs: ev?.timeoutMs ?? vendor.externalProviderTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    perEvent: !!ev,
  };
}

/** Effective INBOUND (callback) config for a (vendor, event): per-event overrides vendor-global. */
export function resolveEventInbound(vendor: ExternalProviderArrangement, event: string): ResolvedInbound {
  const ev = findEvent(vendor, event)?.inbound;
  return {
    callbackUrl: ev?.callbackUrl ?? vendor.externalProviderCallbackPath,
    mapping: ev?.mapping ?? vendor.fieldMappingConfig?.inbound ?? [],
    auth: ev?.auth ?? vendor.authConfig,
    referenceLocation: ev?.referenceLocation ?? 'body',
    referenceField: ev?.referenceField ?? DEFAULT_REFERENCE_FIELD,
    perEvent: !!ev,
  };
}

/** The events a vendor handles: the per-event configs if present, else the legacy trigger list. */
export function listVendorEvents(vendor: ExternalProviderArrangement): string[] {
  if (vendor.externalProviderEvents?.length) return vendor.externalProviderEvents.map((e) => e.event);
  return vendor.externalProviderTriggerEvents ?? [];
}

// Migration helper (§2.4): build per-event configs for a vendor from its trigger-event list + its
// (legacy) vendor-global config, so stored vendor docs carry per-event config. Idempotent: returns
// the existing per-event config unchanged when already present.
export function deriveEventConfigs(vendor: ExternalProviderArrangement): ProviderEventConfig[] {
  if (vendor.externalProviderEvents?.length) return vendor.externalProviderEvents;
  const events = vendor.externalProviderTriggerEvents ?? [];
  return events.map((event): ProviderEventConfig => {
    const outbound: ProviderEventOutboundConfig = {
      ...(vendor.externalProviderApiEndpoint ? { url: vendor.externalProviderApiEndpoint } : {}),
      httpMethod: 'POST',
      mapping: vendor.fieldMappingConfig?.outbound ?? [],
      ...(vendor.authConfig ? { auth: vendor.authConfig } : {}),
      ...(vendor.externalProviderRetryPolicy ? { retryPolicy: vendor.externalProviderRetryPolicy } : {}),
      ...(vendor.externalProviderTimeoutMs != null ? { timeoutMs: vendor.externalProviderTimeoutMs } : {}),
    };
    const inbound: ProviderEventInboundConfig = {
      ...(vendor.externalProviderCallbackPath ? { callbackUrl: vendor.externalProviderCallbackPath } : {}),
      mapping: vendor.fieldMappingConfig?.inbound ?? [],
      ...(vendor.authConfig ? { auth: vendor.authConfig } : {}),
    };
    return { event, outbound, inbound };
  });
}

'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '../../../../../../lib/api';
import { getToken } from '../../../../../../lib/auth';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MappingRule {
  location: 'body' | 'header';
  sourceField: string;
  targetField: string;   // empty string = same as source
  required: boolean;
}

export interface HmacConfig {
  algorithm?: string;
  signatureHeaderName?: string;
  signaturePrefix?: string;
  payloadFormat?: string;
  replayWindowSeconds?: number;
}

export interface AuthConfig {
  scheme?: string;
  bearer?: { tokenHeaderName?: string; tokenPrefix?: string };
  apiKey?: { keyHeaderName?: string; keyLocation?: string };
  hmacOutbound?: Omit<HmacConfig, 'replayWindowSeconds'>;
  hmacInbound?: HmacConfig;
}

export interface FieldMappingConfig {
  // New matrix format used by the redesigned UI
  inboundRules?: MappingRule[];
  outboundRules?: MappingRule[];
  inboundHttpMethod?: string;
  outboundHttpMethod?: string;
  inboundOptions?: {
    maxPayloadKb?: number;
    enforceContentType?: boolean;
    ipAllowlist?: string[];
  };
  // Legacy (kept for backward compat, ignored by new UI)
  outbound?: unknown[];
  inbound?: unknown[];
  schemaVersion?: number;
}

// §2.4: a field mapping as stored per event (sourcePath -> targetPath).
export interface EventFieldMapping {
  sourcePath: string;
  targetPath: string;
  required?: boolean;
}

// §2.4: per-event wire config, each event a vendor handles has its OWN outbound + inbound config
// (its own URL, mapping, auth, retries, timeout, callback). There is NO vendor base URL.
export interface ProviderEventOutboundConfig {
  url?: string;
  // This route's own host per environment, overriding the provider's. Absent means the provider's.
  baseUrlByEnvironment?: Record<string, string>;
  httpMethod?: string;
  mapping?: EventFieldMapping[];
  auth?: AuthConfig;
  retryPolicy?: { maxAttempts: number; backoffMs: number };
  timeoutMs?: number;
}
export interface ProviderEventInboundConfig {
  callbackUrl?: string;
  // The host this platform is told to receive on, per environment. Absent means the `{{psp}}` link.
  baseUrlByEnvironment?: Record<string, string>;
  mapping?: EventFieldMapping[];
  auth?: AuthConfig;
  referenceLocation?: 'body' | 'header';
  referenceField?: string;
}
export interface ProviderEventConfig {
  event: string;
  outbound: ProviderEventOutboundConfig;
  inbound: ProviderEventInboundConfig;
}

export interface Integration {
  externalProviderArrangementInstanceReference: string;
  externalProviderArrangementName: string;
  externalProviderArrangementType: string;
  externalProviderArrangementStatus: string;
  externalProviderIsInternal: boolean;
  externalProviderMode: string;
  externalProviderApiEndpoint?: string;
  // The link this record NAMES for its own host (`{{bankcore}}`), not an address. What it resolves to
  // in this environment arrives separately, in `ResolvedLinks`, because only the server can bind it.
  externalProviderBaseUrl?: string;
  // The provider's base URL in each environment, indexed by the environment's own id. What the
  // Environments editor writes; the deployment's `PSP_ENVIRONMENT` selects the entry that applies.
  externalProviderBaseUrlByEnvironment?: Record<string, string>;
  externalProviderApiKeyPrefix?: string;
  externalProviderHealthStatus?: string;
  externalProviderLastHealthCheckAt?: string;
  externalProviderCallbackEnabled?: boolean;
  externalProviderCallbackPath?: string;
  externalProviderInternalHandler?: string;
  externalProviderRetryPolicy?: { maxAttempts: number; backoffMs: number };
  externalProviderTimeoutMs?: number;
  externalProviderTriggerEvents?: string[];
  externalProviderEvents?: ProviderEventConfig[];
  categoryConfig?: Record<string, unknown>;
  authConfig?: AuthConfig;
  fieldMappingConfig?: FieldMappingConfig;
  routingGroupId?: string;
  routingPriority?: number;
  bianServiceDomain: string;
  bianControlRecordType: string;
  pciDssRequirements: string[];
  recordCreatedDateTime: string;
}

/**
 * Where this provider's routes go, in EVERY environment, as the server resolved them.
 *
 * Separate from `Integration` on purpose: the record is what is stored and editable, this is a view
 * of what the stored value means. Conflating them would invite a save that writes a resolved host
 * back over the declaration, which is the portability this whole indirection buys.
 */
export interface ResolvedLinks {
  activeEnvironment: string;
  environments: Array<{
    environmentId: string;
    active: boolean;
    declared?: string;
    resolved?: string;
    error?: string;
    routes: Array<{
      event: string;
      direction: 'outbound' | 'inbound';
      httpMethod?: string;
      path?: string;
      declared?: string;
      resolved?: string;
      error?: string;
    }>;
  }>;
}

export const TYPE_LABEL: Record<string, string> = {
  fraud_detection: 'Fraud Detection', hrp_sanctions: 'HRP / Sanctions',
  kyc_identity: 'KYC / Identity',     kyb_business: 'KYB / Business',
  aml_monitoring: 'AML Monitoring',   credit_bureau: 'Credit Bureau',
  card_authorization: 'Card Authorization', card_issuer: 'Card Issuer',
  generic: 'Generic',
};

export const TYPE_CATEGORY_PATH: Record<string, string> = {
  fraud_detection: '/system/admin/providers/fds',
  hrp_sanctions:   '/system/admin/providers/hrp',
  kyc_identity:    '/system/admin/providers/kyc',
  kyb_business:    '/system/admin/providers/kyb',
  aml_monitoring:  '/system/admin/providers/aml',
  credit_bureau:   '/system/admin/providers/credit-bureau',
  card_authorization: '/system/admin/providers/card-authorization',
  card_issuer:        '/system/admin/providers/card-issuer',
};

// ── Context ──────────────────────────────────────────────────────────────────

interface CtxValue {
  integration: Integration | null;
  links: ResolvedLinks | null;
  loading: boolean;
  loadError: string | null;
  /** reload(true) refreshes the integration in-place without toggling the loading state,
   *  so the page does NOT unmount/remount (no full-page "refresh" flicker, no local state loss). */
  reload: (silent?: boolean) => void;
  token: string;
}

const IntegrationCtx = createContext<CtxValue>({
  integration: null, links: null, loading: true, loadError: null, reload: () => {}, token: '',
});

export function IntegrationProvider({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const token = getToken() ?? '';
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [links, setLinks] = useState<ResolvedLinks | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    api.integrations.get(id, token)
      .then(d => {
        setIntegration(d.integration as unknown as Integration);
        setLinks((d.links as unknown as ResolvedLinks) ?? null);
      })
      .catch((err: unknown) => {
        const msg = (err as Error)?.message ?? 'Failed to load';
        // On a silent refresh, keep the current view rather than swapping to an error screen.
        if (!silent) setLoadError(msg.toLowerCase().includes('not found') ? 'Integration not found.' : msg);
      })
      .finally(() => { if (!silent) setLoading(false); });
  }, [id, token]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <IntegrationCtx.Provider value={{ integration, links, loading, loadError, reload, token }}>
      {children}
    </IntegrationCtx.Provider>
  );
}

export function useIntegration() {
  return useContext(IntegrationCtx);
}

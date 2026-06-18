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

// §2.4: per-event wire config — each event a vendor handles has its OWN outbound + inbound config
// (its own URL, mapping, auth, retries, timeout, callback). There is NO vendor base URL.
export interface ProviderEventOutboundConfig {
  url?: string;
  httpMethod?: string;
  mapping?: EventFieldMapping[];
  auth?: AuthConfig;
  retryPolicy?: { maxAttempts: number; backoffMs: number };
  timeoutMs?: number;
}
export interface ProviderEventInboundConfig {
  callbackUrl?: string;
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
  loading: boolean;
  loadError: string | null;
  /** reload(true) refreshes the integration in-place without toggling the loading state,
   *  so the page does NOT unmount/remount (no full-page "refresh" flicker, no local state loss). */
  reload: (silent?: boolean) => void;
  token: string;
}

const IntegrationCtx = createContext<CtxValue>({
  integration: null, loading: true, loadError: null, reload: () => {}, token: '',
});

export function IntegrationProvider({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const token = getToken() ?? '';
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    api.integrations.get(id, token)
      .then(d => setIntegration(d.integration as unknown as Integration))
      .catch((err: unknown) => {
        const msg = (err as Error)?.message ?? 'Failed to load';
        // On a silent refresh, keep the current view rather than swapping to an error screen.
        if (!silent) setLoadError(msg.toLowerCase().includes('not found') ? 'Integration not found.' : msg);
      })
      .finally(() => { if (!silent) setLoading(false); });
  }, [id, token]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <IntegrationCtx.Provider value={{ integration, loading, loadError, reload, token }}>
      {children}
    </IntegrationCtx.Provider>
  );
}

export function useIntegration() {
  return useContext(IntegrationCtx);
}

'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';

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
  fraud_detection: '/system/admin/fraud-detection',
  hrp_sanctions:   '/system/admin/hrp',
  kyc_identity:    '/system/admin/kyc',
  kyb_business:    '/system/admin/kyb',
  aml_monitoring:  '/system/admin/aml',
  credit_bureau:   '/system/admin/credit-bureau',
  card_authorization: '/system/admin/card-authorization',
  card_issuer:        '/system/admin/card-issuer',
};

// ── Context ──────────────────────────────────────────────────────────────────

interface CtxValue {
  integration: Integration | null;
  loading: boolean;
  loadError: string | null;
  reload: () => void;
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

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.integrations.get(id, token)
      .then(d => setIntegration(d.integration as unknown as Integration))
      .catch((err: unknown) => {
        const msg = (err as Error)?.message ?? 'Failed to load';
        setLoadError(msg.toLowerCase().includes('not found') ? 'Integration not found.' : msg);
      })
      .finally(() => setLoading(false));
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

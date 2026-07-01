'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  Webhook, Check, Send, Plus, Trash2, Eye, EyeOff,
  ToggleLeft, ToggleRight, ChevronDown, Pencil, Activity, KeyRound,
} from 'lucide-react';
import Link from 'next/link';
import { SectionHeader } from '../../../../components/SectionHeader';
import { useRequireActiveMerchant } from '../../../../lib/merchantContext';
import { useDebugMode } from '../../../../lib/debugMode';
import { api, type TypedWebhookConfig, type WebhookEventType, WEBHOOK_EVENT_LABELS } from '../../../../lib/api';
import { JsonView } from '../../../../components/json/JsonView';

const ALL_EVENT_TYPES: WebhookEventType[] = [
  'payment.completed',
  'payment.failed',
  'oauth.authorization_granted',
  'oauth.authorization_revoked',
  'user.notification',
  'dispute.opened',
  'kyb.status_changed',
];

const EVENT_DESCRIPTIONS: Record<WebhookEventType, string> = {
  'payment.completed': 'Fired when a payment is successfully authorized (ISO 20022 pacs.002 ACSC). Use to update order status.',
  'payment.failed': 'Fired when a payment is declined or fails (pacs.002 RJCT). Use to notify the customer.',
  'oauth.authorization_granted': 'Fired when a user authorizes your app via OIDC. Use to provision user accounts.',
  'oauth.authorization_revoked': 'Fired when a user revokes your app access. Immediately invalidate their session.',
  'user.notification': 'Fired when the PSP sends a notification on behalf of an OIDC-delegated user.',
  'dispute.opened': 'Fired when a cardholder opens a chargeback dispute on one of your transactions.',
  'kyb.status_changed': 'Fired when your KYB verification status changes (e.g. verified, rejected).',
};

interface KVEntry { key: string; value: string }

function kvFromRecord(rec?: Record<string, string>): KVEntry[] {
  return rec ? Object.entries(rec).map(([key, value]) => ({ key, value })) : [];
}

function kvToRecord(entries: KVEntry[]): Record<string, string> {
  return Object.fromEntries(entries.filter((e) => e.key && e.value).map((e) => [e.key, e.value]));
}

function KVEditor({
  label,
  hint,
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  label: string;
  hint?: string;
  entries: KVEntry[];
  onChange: (entries: KVEntry[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-xs font-medium text-gray-700">{label}</span>
          {hint && <span className="text-xs text-gray-400 ml-1">({hint})</span>}
        </div>
        <button
          type="button"
          onClick={() => onChange([...entries, { key: '', value: '' }])}
          className="flex items-center gap-1 text-xs text-[#001E2B] hover:underline"
        >
          <Plus size={11} /> Add
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 italic">None configured.</p>
      ) : (
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-1">
            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Key</span>
            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Value</span>
            <span />
          </div>
          {entries.map((entry, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <input
                value={entry.key}
                onChange={(e) => onChange(entries.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}
                placeholder={keyPlaceholder ?? 'Header name'}
                className="border border-gray-300 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#00ED64]/40"
              />
              <input
                value={entry.value}
                onChange={(e) => onChange(entries.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                placeholder={valuePlaceholder ?? 'Value'}
                className="border border-gray-300 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#00ED64]/40"
              />
              <button type="button" onClick={() => onChange(entries.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ApiKeyMeta { keyId: string; keyPrefix: string; keyLabel: string | null; keyStatus: 'active' | 'revoked' }

function WebhookForm({
  eventType,
  existing,
  merchantId,
  token,
  onChanged,
}: {
  eventType: WebhookEventType;
  existing?: TypedWebhookConfig;
  merchantId: string;
  token: string;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState(existing?.webhookUrl ?? '');
  const [headers, setHeaders] = useState<KVEntry[]>(kvFromRecord(existing?.webhookHeaders));
  const [bodyMapping, setBodyMapping] = useState<KVEntry[]>(kvFromRecord(existing?.webhookAttributeMapping));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // API key auth config
  const [apiKeys, setApiKeys] = useState<ApiKeyMeta[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string>(existing?.webhookApiKeyId ?? '');
  const [keyTransport, setKeyTransport] = useState<'header' | 'body'>(existing?.webhookApiKeyTransport ?? 'header');
  const [keyFieldName, setKeyFieldName] = useState<string>(existing?.webhookApiKeyFieldName ?? '');

  // Test section
  const [testPayload, setTestPayload] = useState<string>('');
  const [testPayloadError, setTestPayloadError] = useState<string | null>(null);
  const [testPayloadLoading, setTestPayloadLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof api.merchants.testTypedWebhook>> | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Load merchant's active API keys once
  useEffect(() => {
    api.merchants.listKeys(merchantId, token)
      .then((r) => setApiKeys(r.keys.filter((k) => k.keyStatus === 'active')))
      .catch(() => {});
  }, [merchantId, token]);

  useEffect(() => {
    setUrl(existing?.webhookUrl ?? '');
    setHeaders(kvFromRecord(existing?.webhookHeaders));
    setBodyMapping(kvFromRecord(existing?.webhookAttributeMapping));
    setSelectedKeyId(existing?.webhookApiKeyId ?? '');
    setKeyTransport(existing?.webhookApiKeyTransport ?? 'header');
    setKeyFieldName(existing?.webhookApiKeyFieldName ?? '');
    setNewSecret(null);
    setTestResult(null);
    setTestError(null);
    setTestPayload('');
    setTestPayloadError(null);
    setSaved(false);
  }, [existing, eventType]);

  // Load canonical test payload when webhook exists
  useEffect(() => {
    if (!existing || testPayload) return;
    setTestPayloadLoading(true);
    api.merchants.getTestPayload(merchantId, existing.webhookId, token)
      .then((r) => setTestPayload(JSON.stringify(r.payload, null, 2)))
      .catch(() => {/* ignore */})
      .finally(() => setTestPayloadLoading(false));
  }, [existing, merchantId, token, testPayload]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    setSaving(true);
    try {
      const attrMap = kvToRecord(bodyMapping);
      const requestHeaders = kvToRecord(headers);
      const apiKeyAuthFields = selectedKeyId
        ? { apiKeyId: selectedKeyId, apiKeyTransport: keyTransport, apiKeyFieldName: keyFieldName || (keyTransport === 'header' ? 'X-Api-Key' : 'apiKey') }
        : { apiKeyId: null as null };
      if (existing) {
        await api.merchants.updateTypedWebhook(merchantId, existing.webhookId, token, {
          url,
          attributeMapping: attrMap,
          headers: requestHeaders,
          ...apiKeyAuthFields,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        onChanged();
      } else {
        const r = await api.merchants.registerTypedWebhook(merchantId, token, {
          eventType,
          url,
          attributeMapping: attrMap,
          headers: requestHeaders,
          ...(selectedKeyId && 'apiKeyId' in apiKeyAuthFields && apiKeyAuthFields.apiKeyId !== null ? apiKeyAuthFields : {}),
        });
        if (r.webhookSecret) { setNewSecret(r.webhookSecret); setShowSecret(true); }
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        onChanged();
      }
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  async function toggle() {
    if (!existing) return;
    setToggling(true);
    try {
      await api.merchants.updateTypedWebhook(merchantId, existing.webhookId, token, {
        status: existing.webhookStatus === 'active' ? 'inactive' : 'active',
      });
      onChanged();
    } catch { /* ignore */ }
    setToggling(false);
  }

  async function del() {
    if (!existing) return;
    setDeleting(true);
    try {
      await api.merchants.deleteTypedWebhook(merchantId, existing.webhookId, token);
      onChanged();
    } catch { /* ignore */ }
    setDeleting(false);
  }

  async function sendTest() {
    if (!existing) return;
    setTestError(null);
    setTestResult(null);

    let parsed: Record<string, unknown> | undefined;
    if (testPayload.trim()) {
      try {
        parsed = JSON.parse(testPayload);
      } catch {
        setTestPayloadError('Invalid JSON. Fix the payload before sending.');
        return;
      }
    }
    setTestPayloadError(null);
    setTesting(true);
    try {
      setTestResult(await api.merchants.testTypedWebhook(merchantId, existing.webhookId, token, parsed));
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Test failed.');
    }
    setTesting(false);
  }

  const isActive = existing?.webhookStatus === 'active';

  return (
    <div className="space-y-4">

      {/* Status bar for existing webhook */}
      {existing && (
        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-200">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="text-sm text-gray-600">{isActive ? 'Active' : 'Inactive'}</span>
            {existing.webhookLastDeliveryStatus && (
              <span className={`text-xs px-2 py-0.5 rounded font-medium ml-2 ${existing.webhookLastDeliveryStatus === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                Last: {existing.webhookLastDeliveryStatus === 'success' ? 'OK' : 'Failed'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button" onClick={toggle} disabled={toggling}
              className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-300 hover:bg-white px-3 py-1.5 rounded-lg transition-colors"
            >
              {isActive ? <ToggleRight size={15} className="text-green-600" /> : <ToggleLeft size={15} />}
              {isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button
              type="button" onClick={del} disabled={deleting}
              className="flex items-center gap-1.5 text-sm text-red-600 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Trash2 size={14} /> Remove
            </button>
          </div>
        </div>
      )}

      {/* Endpoint configuration */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-800 mb-1">Endpoint</p>
        <p className="text-xs text-gray-500 mb-4">{EVENT_DESCRIPTIONS[eventType]}</p>

        <form onSubmit={save} className="space-y-5">
          {/* URL */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">URL</label>
            <input
              type="url" required value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com/webhooks/psp"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            />
            <p className="text-xs text-gray-400 mt-1">
              The PSP posts a signed <code className="font-mono">application/json</code> payload to this URL. Verify with header <code className="font-mono">X-Webhook-Signature: sha256=...</code>
            </p>
          </div>

          {/* Request headers */}
          <KVEditor
            label="Request headers"
            hint="optional; sent with every delivery"
            entries={headers}
            onChange={setHeaders}
            keyPlaceholder="e.g. Authorization"
            valuePlaceholder="e.g. Bearer your-token"
          />

          {/* Body field mapping */}
          <KVEditor
            label="Body field mapping"
            hint="optional; rename PSP fields before delivery"
            entries={bodyMapping}
            onChange={setBodyMapping}
            keyPlaceholder="PSP field (e.g. statusCode)"
            valuePlaceholder="Your field name"
          />

          {/* API key auth */}
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <div className="flex items-center gap-1.5">
              <KeyRound size={12} className="text-gray-400" />
              <span className="text-xs font-medium text-gray-700">API key authentication</span>
              <span className="text-xs text-gray-400">(optional; injected on every delivery)</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">API key</label>
              <div className="relative">
                <select
                  value={selectedKeyId}
                  onChange={(e) => { setSelectedKeyId(e.target.value); setKeyFieldName(''); }}
                  className="w-full appearance-none border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 cursor-pointer"
                >
                  <option value="">None</option>
                  {apiKeys.map((k) => (
                    <option key={k.keyId} value={k.keyId}>
                      {k.keyLabel ? `${k.keyLabel} (${k.keyPrefix})` : k.keyPrefix}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {selectedKeyId && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Via</label>
                  <div className="relative">
                    <select
                      value={keyTransport}
                      onChange={(e) => { setKeyTransport(e.target.value as 'header' | 'body'); setKeyFieldName(''); }}
                      className="w-full appearance-none border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 cursor-pointer"
                    >
                      <option value="header">HTTP header</option>
                      <option value="body">Request body field</option>
                    </select>
                    <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {keyTransport === 'header' ? 'Header name' : 'Field name'}
                  </label>
                  <input
                    value={keyFieldName}
                    onChange={(e) => setKeyFieldName(e.target.value)}
                    placeholder={keyTransport === 'header' ? 'X-Api-Key' : 'apiKey'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit" disabled={saving}
              className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm"
            >
              {saving
                ? 'Saving...'
                : existing
                  ? <><Pencil size={14} /> Update</>
                  : <><Plus size={14} /> Register webhook</>}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-green-700">
                <Check size={14} /> {existing ? 'Updated.' : 'Registered.'}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Signing secret notice on first register */}
      {newSecret && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-amber-800">Signing secret. Store it now; shown once.</p>
            <button onClick={() => setShowSecret((s) => !s)} className="text-amber-600 hover:text-amber-800">
              {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <p className="font-mono text-xs text-amber-900 break-all">{showSecret ? newSecret : '•'.repeat(40)}</p>
          <p className="text-[11px] text-amber-700">Verify with: <code className="font-mono">sha256=HMAC-SHA256(rawBody, secret)</code></p>
        </div>
      )}

      {/* Test section — always visible for configured webhooks */}
      {existing && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><Send size={13} /> Test endpoint</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Edit the payload below and send it to your URL. Marked <code className="font-mono">test:true</code>. Results are persisted in
                {' '}<Link href="/system/merchant/events" className="underline hover:text-[#001E2B]">Events</Link>.
              </p>
            </div>
            <button
              onClick={sendTest} disabled={testing || !isActive}
              title={!isActive ? 'Activate this webhook before sending a test' : undefined}
              className="flex items-center gap-1.5 border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] text-xs font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <Send size={12} /> {testing ? 'Sending...' : 'Send test'}
            </button>
          </div>
          {!isActive && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Webhook is inactive. Activate it above to enable test delivery.
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Payload (editable)</label>
            {testPayloadLoading ? (
              <div className="text-xs text-gray-400 py-3">Loading canonical payload...</div>
            ) : (
              <textarea
                value={testPayload}
                onChange={(e) => { setTestPayload(e.target.value); setTestPayloadError(null); }}
                rows={14}
                spellCheck={false}
                className={`w-full font-mono text-xs border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 resize-y bg-gray-50 ${testPayloadError ? 'border-red-400' : 'border-gray-300'}`}
              />
            )}
            {testPayloadError && <p className="text-xs text-red-600 mt-1">{testPayloadError}</p>}
          </div>

          {testError && <p className="text-xs text-red-600">{testError}</p>}

          {testResult && (
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <div className={`flex items-center gap-2 text-sm font-medium ${testResult.delivered ? 'text-green-700' : 'text-red-600'}`}>
                {testResult.delivered ? <Check size={14} /> : <span className="font-bold">!</span>}
                {testResult.delivered ? 'Delivered' : 'Not delivered'}
                {typeof testResult.statusCode === 'number' && (
                  <span className="text-gray-500 font-normal text-xs">HTTP {testResult.statusCode}</span>
                )}
                <span className="text-gray-400 font-normal text-xs">{testResult.attempts} attempt(s)</span>
              </div>
              {testResult.error && <p className="text-xs text-red-600">{testResult.error}</p>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">Request headers sent</p>
                  <JsonView data={testResult.requestHeaders} maxHeight="12rem" collapsed={1} />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">Request body sent</p>
                  <JsonView data={testResult.requestBody} maxHeight="12rem" collapsed={2} />
                </div>
              </div>

              {testResult.response && (
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">Endpoint response</p>
                  <JsonView data={testResult.response} maxHeight="10rem" collapsed={2} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WebhooksSectionPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const { debugMode } = useDebugMode();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';
  const [webhooks, setWebhooks] = useState<TypedWebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<WebhookEventType | ''>('');

  const reload = useCallback(async () => {
    if (!merchantId || !token) return;
    try {
      const r = await api.merchants.listTypedWebhooks(merchantId, token);
      setWebhooks(r.webhooks);
    } catch { /* ignore */ }
    setLoading(false);
  }, [merchantId, token]);

  useEffect(() => { reload(); }, [reload]);

  if (!merchant) return null;

  const selectedWebhook = selectedType ? webhooks.find((w) => w.webhookEventType === selectedType) : undefined;
  const activeCount = webhooks.filter((w) => w.webhookStatus === 'active').length;

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          icon={Webhook}
          title="Webhooks"
          description="Configure per-event outbound callbacks with HMAC-SHA256 signing, custom headers, and body field mapping."
          debugInfo="BIAN SD-89 BQ:Notification, ADR-038, PCI DSS Req 12.8, ISO 20022 pacs.002"
        />
        <Link
          href="/system/merchant/events"
          className="flex items-center gap-1.5 text-xs border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors shrink-0 mt-1"
        >
          <Activity size={13} /> Events log
        </Link>
      </div>

      {!loading && (
        <p className="text-xs text-gray-500 flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${activeCount > 0 ? 'bg-green-500' : 'bg-gray-300'}`} />
          {activeCount > 0
            ? `${activeCount} of ${ALL_EVENT_TYPES.length} event types active`
            : 'No webhooks configured yet'}
        </p>
      )}

      {/* Event type selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-800 mb-1">Event type</p>
        <p className="text-xs text-gray-500 mb-3">
          Select an event to configure its outbound webhook. Each event type has its own URL, headers, signing secret, and body field mapping.
        </p>
        <div className="relative">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as WebhookEventType | '')}
            className="w-full appearance-none border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 cursor-pointer"
          >
            <option value="">Select an event type...</option>
            {ALL_EVENT_TYPES.map((type) => {
              const w = webhooks.find((wh) => wh.webhookEventType === type);
              const suffix = w
                ? w.webhookStatus === 'active' ? ' (active)' : ' (inactive)'
                : ' (not configured)';
              return <option key={type} value={type}>{WEBHOOK_EVENT_LABELS[type]}{suffix}</option>;
            })}
          </select>
          <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {loading && <p className="text-sm text-gray-400">Loading...</p>}

      {!loading && selectedType && (
        <WebhookForm
          key={selectedType}
          eventType={selectedType}
          existing={selectedWebhook}
          merchantId={merchantId}
          token={token}
          onChanged={reload}
        />
      )}

      {!loading && !selectedType && (
        <div className="text-center py-10 text-gray-400">
          <Webhook size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select an event type above to view or configure its webhook.</p>
        </div>
      )}

      {debugMode && (
        <div className="bg-[#001E2B]/5 rounded-xl border border-[#001E2B]/15 p-4 text-xs text-gray-600 space-y-2">
          <p className="font-semibold text-[#001E2B]">How it works</p>
          <p>Each event type has its own URL, signing secret, optional custom headers, and body field mapping. The PSP posts a signed <code className="font-mono">application/json</code> payload. Verify with <code className="font-mono">X-Webhook-Signature: sha256=HMAC-SHA256(rawBody, secret)</code>.</p>
          <p className="text-gray-500">Custom headers are sent with every delivery request. Body field mapping renames PSP fields before delivery, server-side. Test payloads use the canonical ISO 20022 schema for each event and are persisted in the delivery log.</p>
          <p className="font-mono text-gray-400 pt-1">BIAN SD-89 BQ:Notification, ADR-038, PCI DSS Req 12.8, ISO 20022 pacs.002</p>
        </div>
      )}
    </div>
  );
}

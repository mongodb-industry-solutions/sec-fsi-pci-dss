'use client';
import { useState } from 'react';
import { FlaskConical, Play, Info } from 'lucide-react';
import { useIntegration } from '../_context';
import type { MappingRule, FieldMappingConfig } from '../_context';
import { FieldMappingMatrix, SaveBtn, Card, StatusToggle, FieldLabel } from '../_shared';
import { api } from '../../../../../../lib/api';
import { getOutboundSample } from '../_samples';
import { useNotify } from '../../../../../../components/ui/ConfirmProvider';
import { classifyEndpoint } from '../_endpoint';

// ── Category settings ─────────────────────────────────────────────────────────

function CategorySettings({
  config,
  setConfig,
}: { config: Record<string, unknown>; setConfig: (c: Record<string, unknown>) => void }) {
  const entries = Object.entries(config);
  if (entries.length === 0) return <p className="text-xs text-gray-400 italic">No category-specific settings defined.</p>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {entries.map(([key, value]) => {
        const label = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
        if (typeof value === 'boolean') return (
          <div key={key} className="flex items-center gap-2">
            <input type="checkbox" id={key} checked={value}
              onChange={e => setConfig({ ...config, [key]: e.target.checked })}
              className="rounded border-gray-300" />
            <label htmlFor={key} className="text-sm text-gray-700 capitalize cursor-pointer">{label}</label>
          </div>
        );
        if (typeof value === 'number') return (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-600 mb-1.5 capitalize">{label}</label>
            <input type="number" value={value}
              onChange={e => setConfig({ ...config, [key]: parseFloat(e.target.value) })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        );
        if (Array.isArray(value)) return (
          <div key={key} className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1.5 capitalize">{label} (comma-separated)</label>
            <input value={(value as string[]).join(', ')}
              onChange={e => setConfig({ ...config, [key]: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
          </div>
        );
        return (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-600 mb-1.5 capitalize">{label}</label>
            <input value={String(value)}
              onChange={e => setConfig({ ...config, [key]: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        );
      })}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OutboundPage() {
  const { integration, reload, token } = useIntegration();
  const notify = useNotify();

  if (!integration) return null;

  const id   = integration.externalProviderArrangementInstanceReference;
  const fmc  = integration.fieldMappingConfig ?? {};
  const auth = integration.authConfig ?? {};

  const isActive   = integration.externalProviderArrangementStatus === 'active';
  const isInternal = integration.externalProviderIsInternal;

  const [togglingStatus, setTogglingStatus] = useState(false);
  const [endpoint, setEndpoint]       = useState(integration.externalProviderApiEndpoint ?? '');
  const [httpMethod, setHttpMethod]   = useState(fmc.outboundHttpMethod ?? 'POST');
  const [mode, setMode]               = useState(integration.externalProviderMode ?? 'sync');
  const [timeoutMs, setTimeoutMs]     = useState(integration.externalProviderTimeoutMs ?? 5000);
  const [maxAttempts, setMaxAttempts] = useState(integration.externalProviderRetryPolicy?.maxAttempts ?? 3);
  const [backoffMs, setBackoffMs]     = useState(integration.externalProviderRetryPolicy?.backoffMs ?? 500);
  const [outboundRules, setOutboundRules]   = useState<MappingRule[]>(fmc.outboundRules ?? []);
  const [categoryConfig, setCategoryConfig] = useState<Record<string, unknown>>(integration.categoryConfig ?? {});

  const [scheme, setScheme]                 = useState(auth.scheme ?? 'bearer');
  const [bearerHeader, setBearerHeader]     = useState(auth.bearer?.tokenHeaderName ?? 'Authorization');
  const [bearerPrefix, setBearerPrefix]     = useState(auth.bearer?.tokenPrefix ?? 'Bearer');
  const [apiKeyHeader, setApiKeyHeader]     = useState(auth.apiKey?.keyHeaderName ?? 'X-API-Key');
  const [apiKeyLocation, setApiKeyLocation] = useState(auth.apiKey?.keyLocation ?? 'header');
  const [hmacAlgo, setHmacAlgo]             = useState(auth.hmacOutbound?.algorithm ?? 'sha256');
  const [hmacHeader, setHmacHeader]         = useState(auth.hmacOutbound?.signatureHeaderName ?? 'X-Signature-256');
  const [hmacPrefix, setHmacPrefix]         = useState(auth.hmacOutbound?.signaturePrefix ?? 'sha256=');
  const [hmacFormat, setHmacFormat]         = useState(auth.hmacOutbound?.payloadFormat ?? 'hex');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  const [testPayload, setTestPayload]           = useState(() => getOutboundSample(integration.externalProviderArrangementType));
  const [testPayloadError, setTestPayloadError] = useState('');
  const [testResult, setTestResult]             = useState<{ original: Record<string, unknown>; transformed: Record<string, unknown>; appliedRules: number } | null>(null);
  const [testError, setTestError]               = useState('');
  const [testing, setTesting]                   = useState(false);

  // Run Test (real execution) state — separate from Validate Params (dry-run mapping above)
  const [overrideUrl, setOverrideUrl] = useState('');
  const [running, setRunning]         = useState(false);
  const [runResult, setRunResult]     = useState<{ status: string; latencyMs: number; responseCode?: number; responseBody?: unknown; targetUrl?: string; transformed: Record<string, unknown>; error?: string } | null>(null);
  const effectiveTarget = overrideUrl.trim() || endpoint;
  const endpointInfo = classifyEndpoint(effectiveTarget);

  async function toggleStatus() {
    setTogglingStatus(true);
    try {
      await api.integrations.update(id, {
        externalProviderArrangementStatus: isActive ? 'inactive' : 'active',
      }, token);
      reload(true);
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setTogglingStatus(false); }
  }

  async function handleSave() {
    setSaving(true);
    const authConfig = {
      ...auth,
      scheme,
      ...(scheme === 'bearer'  ? { bearer:      { tokenHeaderName: bearerHeader, tokenPrefix: bearerPrefix } }          : {}),
      ...(scheme === 'api_key' ? { apiKey:       { keyHeaderName: apiKeyHeader, keyLocation: apiKeyLocation } }          : {}),
      ...(scheme === 'hmac'    ? { hmacOutbound: { algorithm: hmacAlgo, signatureHeaderName: hmacHeader, signaturePrefix: hmacPrefix, payloadFormat: hmacFormat } } : {}),
    };
    const newFmc: FieldMappingConfig = { ...fmc, outboundRules, outboundHttpMethod: httpMethod };
    try {
      await api.integrations.update(id, {
        externalProviderApiEndpoint:  endpoint || undefined,
        externalProviderMode:         mode,
        externalProviderTimeoutMs:    timeoutMs,
        externalProviderRetryPolicy:  { maxAttempts, backoffMs },
        authConfig,
        fieldMappingConfig:           newFmc,
        categoryConfig,
      }, token);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      reload(true); // silent: refresh context in place, no full-page remount
    } finally { setSaving(false); }
  }

  async function handleTestMapping() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(testPayload) as Record<string, unknown>;
      setTestPayloadError('');
    } catch (e) {
      setTestPayloadError((e as Error).message);
      return;
    }
    setTesting(true); setTestError(''); setTestResult(null);
    try {
      const r = await api.integrations.testMapping(id, { direction: 'outbound', payload: parsed }, token);
      setTestResult(r);
    } catch (err) { setTestError((err as Error).message); }
    finally { setTesting(false); }
  }

  async function handleRunTest() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(testPayload) as Record<string, unknown>;
      setTestPayloadError('');
    } catch (e) {
      setTestPayloadError((e as Error).message);
      return;
    }
    if (!endpointInfo.valid) { notify('Enter a valid URL (https://… or an internal /path).', 'error'); return; }
    setRunning(true); setTestError(''); setRunResult(null);
    try {
      const r = await api.integrations.runTest(id, { direction: 'outbound', payload: parsed, overrideUrl: overrideUrl.trim() || undefined }, token);
      setRunResult(r);
      notify(`Run test ${r.status}${r.responseCode ? ` (HTTP ${r.responseCode})` : ''}. See the Events tab.`, r.status === 'received' ? 'success' : 'error');
    } catch (err) { setTestError((err as Error).message); }
    finally { setRunning(false); }
  }

  const endpointPlaceholder = isInternal
    ? '/api/v1/integrations/hrp/screen'
    : 'https://api.provider.com/v1/score';

  return (
    <div className="space-y-5">

      {/* ── Outbound status ────────────────────────────────────────────────── */}
      <Card title="Outbound status">
        <p className="text-sm text-gray-600 leading-relaxed mb-4">
          {isInternal
            ? 'The outbound section configures the API endpoint that LeafyBank calls when this built-in integration is triggered. Even built-in providers follow the API-first approach and call a backend endpoint with the specified fields.'
            : 'The outbound section configures where and how LeafyBank sends data when this integration is triggered; endpoint, authentication, field mapping, and transport settings.'}
        </p>
        <StatusToggle
          enabled={isActive}
          onToggle={toggleStatus}
          loading={togglingStatus}
          enabledLabel="Active"
          disabledLabel="Inactive"
          enabledDescription={
            isInternal
              ? 'This integration is active and will call the backend API endpoint on matching events.'
              : 'This integration is active and will call the external endpoint on matching events.'
          }
          disabledDescription="This integration is inactive and will be skipped. Traffic falls back to the next provider in the routing group."
        />
        {isInternal && integration.externalProviderInternalHandler && (
          <p className="text-xs text-gray-400 mt-3 pl-16">
            Internal module: <code className="font-mono bg-gray-100 px-1 rounded">{integration.externalProviderInternalHandler}</code>
          </p>
        )}
      </Card>

      {/* ── Endpoint + transport ───────────────────────────────────────────── */}
      <Card
        title="Endpoint"
        subtitle={isInternal ? 'Backend API endpoint this integration calls.' : 'External API endpoint this integration calls.'}>
        <div className="space-y-4">
          <div>
            <FieldLabel
              label="URL"
              hint={isInternal
                ? 'Backend API path this integration POSTs to when triggered. Use a relative path (e.g. /api/v1/hrp/screen) or a full URL for cross-service calls.'
                : 'Full URL of the external API endpoint. LeafyBank will send requests here when the integration is triggered.'} />
            <input value={endpoint} onChange={e => setEndpoint(e.target.value)}
              placeholder={endpointPlaceholder}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <FieldLabel
                label="HTTP method"
                hint="HTTP verb used for the request. POST is standard for most integration APIs that receive a payload. Use GET only for read-only lookups." />
              <select value={httpMethod} onChange={e => setHttpMethod(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </select>
            </div>
            <div>
              <FieldLabel
                label="Mode"
                hint="Synchronous: LeafyBank waits for the response before continuing the transaction flow. Asynchronous: the call is dispatched in the background and the result arrives via the inbound callback." />
              <select value={mode} onChange={e => setMode(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="sync">Synchronous</option>
                <option value="async">Asynchronous</option>
              </select>
            </div>
            <div>
              <FieldLabel
                label="Timeout (ms)"
                hint="Maximum time in milliseconds LeafyBank will wait for the endpoint to respond. Requests that exceed this are cancelled and retried according to the retry policy." />
              <input type="number" value={timeoutMs} onChange={e => setTimeoutMs(parseInt(e.target.value))}
                min={100} max={30000}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <FieldLabel
                label="Max retries"
                hint="Number of additional attempts after a failed request. Set to 0 to disable retries. Retries use exponential backoff starting at the backoff value below." />
              <input type="number" value={maxAttempts} onChange={e => setMaxAttempts(parseInt(e.target.value))}
                min={0} max={10}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <FieldLabel
              label="Retry backoff (ms)"
              hint="Base wait time in milliseconds between retry attempts. Each subsequent attempt doubles this value (exponential backoff). Example: 500 ms → 1 000 ms → 2 000 ms." />
            <input type="number" value={backoffMs} onChange={e => setBackoffMs(parseInt(e.target.value))}
              min={100} max={30000}
              className="w-36 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </Card>

      {/* ── Authentication ─────────────────────────────────────────────────── */}
      <Card
        title="Authentication"
        subtitle="Credentials LeafyBank sends to prove its identity when calling the endpoint.">
        <div className="space-y-4">
          <div>
            <FieldLabel
              label="Scheme"
              hint="Authentication method required by the endpoint. Choose Bearer for JWT/token APIs, API Key for simpler key-based auth, HMAC to sign the request body, or OAuth2 for token-exchange flows." />
            <select value={scheme} onChange={e => setScheme(e.target.value)}
              className="w-52 border border-gray-300 rounded-lg px-3 py-2 text-sm">
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="api_key">API key</option>
              <option value="hmac">HMAC signed request</option>
              <option value="oauth2_cc">OAuth2 client credentials</option>
            </select>
          </div>

          {scheme === 'bearer' && (
            <div className="border-t pt-4 grid grid-cols-2 gap-4">
              <div>
                <FieldLabel
                  label="Header name"
                  hint="HTTP header that carries the token. The standard is 'Authorization'. Some APIs use custom headers like 'X-Auth-Token'." />
                <input value={bearerHeader} onChange={e => setBearerHeader(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <FieldLabel
                  label="Token prefix"
                  hint="Text prepended to the token value in the header. The standard is 'Bearer' (e.g. 'Bearer eyJ...'). Leave blank if the header should contain only the raw token." />
                <input value={bearerPrefix} onChange={e => setBearerPrefix(e.target.value)}
                  placeholder="Bearer"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
            </div>
          )}

          {scheme === 'api_key' && (
            <div className="border-t pt-4 grid grid-cols-2 gap-4">
              <div>
                <FieldLabel
                  label="Header / parameter name"
                  hint="Name of the header or query parameter that carries the API key. Common values: X-API-Key, api_key, Authorization." />
                <input value={apiKeyHeader} onChange={e => setApiKeyHeader(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <FieldLabel
                  label="Key location"
                  hint="Whether the API key is sent as a request header or appended to the URL as a query parameter (e.g. ?api_key=...)." />
                <select value={apiKeyLocation} onChange={e => setApiKeyLocation(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="header">Request header</option>
                  <option value="query">Query parameter</option>
                </select>
              </div>
            </div>
          )}

          {scheme === 'hmac' && (
            <div className="border-t pt-4 grid grid-cols-2 gap-4">
              <div>
                <FieldLabel
                  label="Algorithm"
                  hint="Hash function used to compute the HMAC signature of the request body. SHA-256 is the most common and recommended." />
                <select value={hmacAlgo} onChange={e => setHmacAlgo(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="sha256">HMAC-SHA256</option>
                  <option value="sha512">HMAC-SHA512</option>
                </select>
              </div>
              <div>
                <FieldLabel
                  label="Signature header"
                  hint="HTTP header in which LeafyBank sends the computed signature. The receiving endpoint will read this header to verify the request." />
                <input value={hmacHeader} onChange={e => setHmacHeader(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <FieldLabel
                  label="Signature prefix"
                  hint="Text prepended to the signature in the header (e.g. 'sha256='). Must match what the receiving endpoint expects." />
                <input value={hmacPrefix} onChange={e => setHmacPrefix(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <FieldLabel
                  label="Encoding"
                  hint="How the HMAC bytes are encoded in the header. Hex is the most common. Base64 is used by some providers." />
                <select value={hmacFormat} onChange={e => setHmacFormat(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="hex">Hex</option>
                  <option value="base64">Base64</option>
                </select>
              </div>
            </div>
          )}

          {scheme === 'oauth2_cc' && (
            <p className="text-xs text-gray-400 border-t pt-3">
              OAuth2 client credentials; token endpoint and client secret are managed by the LeafyBank vault. Contact the platform team to configure credentials.
            </p>
          )}
        </div>
      </Card>

      {/* ── Field mapping ──────────────────────────────────────────────────── */}
      <Card
        title="Field mapping"
        subtitle="Maps LeafyBank's internal field names to the names the endpoint expects. Leave the target blank to send the field with its original name. Use dot notation for nested fields: payload.transaction.amount">
        <FieldMappingMatrix
          rules={outboundRules}
          setRules={setOutboundRules}
          sourceLabel="LeafyBank field"
          targetLabel="Endpoint expects" />
      </Card>

      {/* ── Provider / category settings ──────────────────────────────────── */}
      <Card
        title="Provider settings"
        subtitle="Category-specific parameters that configure the behaviour of this integration type (e.g. score thresholds, sensitivity levels, enabled rule sets).">
        <CategorySettings config={categoryConfig} setConfig={setCategoryConfig} />
      </Card>

      <SaveBtn saving={saving} saved={saved} onClick={handleSave} />

      {/* ── Outbound test ──────────────────────────────────────────────────── */}
      <Card
        title="Test outbound request"
        subtitle="Validate Params previews the field mapping without calling anything. Run Test performs a real HTTP dispatch and records an event in the Events tab.">
        <div className="space-y-4">

          {!isActive && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <Info size={13} className="mt-0.5 shrink-0 text-amber-600" />
              <p>This integration is <strong>inactive</strong>. Activate it in the Outbound status section above to validate or run a test.</p>
            </div>
          )}

          {/* Test target URL (override) */}
          <div>
            <FieldLabel
              label="Test target URL (optional override)"
              hint="Leave blank to use the configured endpoint. Enter a URL here to run a one-off test against a different target without changing the saved configuration." />
            <input
              value={overrideUrl}
              onChange={e => setOverrideUrl(e.target.value)}
              placeholder={endpoint || 'https://api.provider.com/v1/score'}
              className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 ${endpointInfo.valid ? 'border-gray-300 focus:ring-violet-400' : 'border-red-400 bg-red-50'}`} />
            {!endpointInfo.valid && (
              <p className="mt-1 text-xs text-red-600">Enter an absolute URL (https://…) or an internal path starting with /.</p>
            )}
            {!effectiveTarget && (
              <p className="mt-1 text-xs text-gray-400">No endpoint configured; set the URL in the Endpoint section above or enter an override.</p>
            )}
            {endpointInfo.isInternal && endpointInfo.note && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                <Info size={13} className="mt-0.5 shrink-0" />
                <div>
                  <p>{endpointInfo.note}</p>
                  {endpointInfo.resolved && <p className="mt-0.5 font-mono break-all">{endpointInfo.resolved}</p>}
                </div>
              </div>
            )}
          </div>

          {/* Payload editor */}
          <div>
            <FieldLabel
              label="Request payload"
              hint="JSON body transformed by the outbound field mapping rules above. Edit it to test different scenarios." />
            <textarea
              value={testPayload}
              onChange={e => { setTestPayload(e.target.value); setTestPayloadError(''); }}
              rows={14}
              spellCheck={false}
              className={`w-full border rounded-lg px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-violet-400 ${testPayloadError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`} />
            {testPayloadError && (
              <p className="mt-1 text-xs text-red-600">⚠ Invalid JSON; {testPayloadError}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleTestMapping}
              disabled={testing || !!testPayloadError || !isActive}
              title={!isActive ? 'Activate the integration to test it' : undefined}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
              <FlaskConical size={12} className={testing ? 'animate-spin' : ''} />
              {testing ? 'Validating…' : 'Validate Params'}
            </button>
            <button
              onClick={handleRunTest}
              disabled={running || !!testPayloadError || !endpointInfo.valid || !effectiveTarget || !isActive}
              title={!isActive ? 'Activate the integration to run a test' : !effectiveTarget ? 'Configure an endpoint or enter an override URL' : undefined}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] hover:bg-[#00ED64] hover:text-[#001E2B] disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-semibold">
              <Play size={12} />
              {running ? 'Running…' : 'Run Test'}
            </button>
          </div>

          {testError && <p className="text-xs text-red-600">⚠ {testError}</p>}

          {/* Validate Params result */}
          {testResult && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600">
                Validate Params: {testResult.appliedRules} mapping rule{testResult.appliedRules !== 1 ? 's' : ''} applied
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Original payload (LeafyBank internal)</p>
                  <pre className="bg-gray-50 border rounded-lg p-3 text-xs font-mono overflow-auto max-h-52">{JSON.stringify(testResult.original, null, 2)}</pre>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Transformed payload (would be sent)</p>
                  <pre className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs font-mono overflow-auto max-h-52">{JSON.stringify(testResult.transformed, null, 2)}</pre>
                </div>
              </div>
            </div>
          )}

          {/* Run Test result */}
          {runResult && (
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-medium text-gray-600">Run Test result:</span>
                <span className={`px-2 py-0.5 rounded-full font-medium ${runResult.status === 'received' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{runResult.status}</span>
                {runResult.responseCode !== undefined && <span className="text-gray-500">HTTP {runResult.responseCode}</span>}
                <span className="text-gray-400">{runResult.latencyMs} ms</span>
                {runResult.targetUrl && <code className="font-mono text-gray-500 break-all">→ {runResult.targetUrl}</code>}
              </div>
              {runResult.error && <p className="text-xs text-red-600">⚠ {runResult.error}</p>}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Payload sent</p>
                  <pre className="bg-gray-50 border rounded-lg p-3 text-xs font-mono overflow-auto max-h-52">{JSON.stringify(runResult.transformed, null, 2)}</pre>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Response received</p>
                  <pre className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs font-mono overflow-auto max-h-52">{runResult.responseBody !== undefined ? (typeof runResult.responseBody === 'string' ? runResult.responseBody : JSON.stringify(runResult.responseBody, null, 2)) : (runResult.error ? 'No response (request failed).' : 'No response body.')}</pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

'use client';
import { useState } from 'react';
import { Copy, Check, Shield, ShieldOff, FlaskConical, Play, Info } from 'lucide-react';
import { useIntegration } from '../_context';
import type { MappingRule, HmacConfig, FieldMappingConfig } from '../_context';
import { FieldMappingMatrix, SaveBtn, Card, StatusToggle, FieldLabel } from '../_shared';
import { api } from '../../../../../../lib/api';
import { getInboundSample } from '../_samples';
import { useNotify, useConfirm } from '../../../../../../components/ui/ConfirmProvider';
import { classifyEndpoint } from '../_endpoint';
import { JsonView } from '../../../../../../components/json/JsonView';
import { JsonEditor } from '../../../../../../components/json/JsonEditor';

// ── Copy helper ───────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button onClick={copy} title="Copy to clipboard" className="text-gray-400 hover:text-gray-700 transition-colors">
      {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function InboundPage() {
  const { integration, reload, token } = useIntegration();
  const notify = useNotify();
  const confirm = useConfirm();

  if (!integration) return null;

  const id  = integration.externalProviderArrangementInstanceReference;
  const fmc = integration.fieldMappingConfig ?? {};

  const callbackPath = integration.externalProviderCallbackPath || `${id}/callback`;
  const webhookUrl   = `/api/v1/webhooks/${callbackPath}`;

  // ── Immediate toggle ──────────────────────────────────────────────────────
  const [callbackEnabled, setCallbackEnabled]   = useState(integration.externalProviderCallbackEnabled ?? false);
  const [togglingCallback, setTogglingCallback] = useState(false);

  async function handleToggleCallback() {
    setTogglingCallback(true);
    try {
      await api.integrations.update(id, { externalProviderCallbackEnabled: !callbackEnabled }, token);
      setCallbackEnabled(v => !v);
      reload(true); // silent: persist + refresh context without remounting the page
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setTogglingCallback(false); }
  }

  // ── Form state ────────────────────────────────────────────────────────────
  const [httpMethod, setHttpMethod]     = useState(fmc.inboundHttpMethod ?? 'POST');
  const [inboundRules, setInboundRules] = useState<MappingRule[]>(fmc.inboundRules ?? []);

  const existingHmac = integration.authConfig?.hmacInbound ?? {};
  const [secEnabled, setSecEnabled]       = useState(!!existingHmac.algorithm);
  const [algorithm, setAlgorithm]         = useState(existingHmac.algorithm ?? 'sha256');
  const [sigHeader, setSigHeader]         = useState(existingHmac.signatureHeaderName ?? 'X-Signature-256');
  const [sigPrefix, setSigPrefix]         = useState(existingHmac.signaturePrefix ?? 'sha256=');
  const [payloadFormat, setPayloadFormat] = useState(existingHmac.payloadFormat ?? 'hex');
  const [replayWindow, setReplayWindow]   = useState(existingHmac.replayWindowSeconds ?? 300);

  const opts = fmc.inboundOptions ?? {};
  const [maxPayloadKb, setMaxPayloadKb] = useState(opts.maxPayloadKb ?? 256);
  const [enforceJson, setEnforceJson]   = useState(opts.enforceContentType ?? true);
  const [ipAllowlist, setIpAllowlist]   = useState((opts.ipAllowlist ?? []).join(', '));

  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  const [inboundSample, setInboundSample]           = useState(() => getInboundSample(integration.externalProviderArrangementType));
  const [inboundSampleError, setInboundSampleError] = useState('');
  const [inboundTestResult, setInboundTestResult]   = useState<{ original: Record<string, unknown>; transformed: Record<string, unknown>; appliedRules: number } | null>(null);
  const [inboundTestError, setInboundTestError]     = useState('');
  const [inboundTesting, setInboundTesting]         = useState(false);

  // Run Test (real reception) state; separate from Validate Params (dry-run mapping)
  const [overrideUrl, setOverrideUrl] = useState('');
  const [running, setRunning]         = useState(false);
  const [runResult, setRunResult]     = useState<{ status: string; latencyMs: number; transformed: Record<string, unknown>; error?: string } | null>(null);
  const effectiveTarget = overrideUrl.trim() || webhookUrl;
  const endpointInfo = classifyEndpoint(effectiveTarget);

  function parseSample(): Record<string, unknown> | null {
    try {
      const p = JSON.parse(inboundSample) as Record<string, unknown>;
      setInboundSampleError('');
      return p;
    } catch (e) {
      setInboundSampleError((e as Error).message);
      return null;
    }
  }

  // Validate Params; dry-run: applies the inbound mapping only, no execution.
  async function handleValidateInbound() {
    const parsed = parseSample();
    if (!parsed) return;
    setInboundTesting(true); setInboundTestError(''); setInboundTestResult(null);
    try {
      const r = await api.integrations.testMapping(id, { direction: 'inbound', payload: parsed }, token);
      setInboundTestResult(r);
    } catch (err) { setInboundTestError((err as Error).message); }
    finally { setInboundTesting(false); }
  }

  // Run Test; real reception: processes the payload and records a callback event.
  async function handleRunInbound() {
    const parsed = parseSample();
    if (!parsed) return;
    const providerName = integration?.externalProviderArrangementName ?? 'this provider';
    const ok = await confirm({
      title: 'Run inbound test?',
      message: `Simulates a real webhook reception from "${providerName}" at ${effectiveTarget}. The payload is processed through the inbound mapping and a callback event is recorded in the Events tab.`,
      confirmLabel: 'Run test',
    });
    if (!ok) return;
    setRunning(true); setInboundTestError(''); setRunResult(null);
    try {
      const r = await api.integrations.runTest(id, { direction: 'inbound', payload: parsed, overrideUrl: overrideUrl.trim() || undefined }, token);
      setRunResult(r);
      notify(`Inbound run test ${r.status}. See the Events tab.`, r.status === 'received' ? 'success' : 'error');
    } catch (err) { setInboundTestError((err as Error).message); }
    finally { setRunning(false); }
  }

  async function handleSave() {
    setSaving(true);
    const hmacInbound: HmacConfig | undefined = secEnabled
      ? { algorithm, signatureHeaderName: sigHeader, signaturePrefix: sigPrefix, payloadFormat, replayWindowSeconds: replayWindow }
      : undefined;
    const newFmc: FieldMappingConfig = {
      ...fmc,
      inboundRules,
      inboundHttpMethod: httpMethod,
      inboundOptions: {
        maxPayloadKb,
        enforceContentType: enforceJson,
        ipAllowlist: ipAllowlist.split(',').map(s => s.trim()).filter(Boolean),
      },
    };
    try {
      await api.integrations.update(id, {
        authConfig: { ...(integration?.authConfig ?? {}), hmacInbound },
        fieldMappingConfig: newFmc,
      }, token);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      reload(true); // silent: refresh context in place, no full-page remount
    } finally { setSaving(false); }
  }

  const isInternal = integration.externalProviderIsInternal;

  return (
    <div className="space-y-5">

      {/* ── Inbound status ─────────────────────────────────────────────────── */}
      <Card title="Inbound status">
        <p className="text-sm text-gray-600 leading-relaxed mb-4">
          {isInternal
            ? 'The inbound section configures how this integration receives response data from the backend API. When the API finishes processing a request, it can deliver results asynchronously to the callback endpoint defined here.'
            : 'The inbound section configures how this integration receives data from the external provider. Providers use the callback URL to send event notifications, async results, or status updates back to the PSP.'}
        </p>
        <StatusToggle
          enabled={callbackEnabled}
          onToggle={handleToggleCallback}
          loading={togglingCallback}
          enabledLabel={isInternal ? 'Response callback enabled' : 'Inbound webhook enabled'}
          disabledLabel={isInternal ? 'Response callback disabled' : 'Inbound webhook disabled'}
          enabledDescription={isInternal
            ? 'The backend API will deliver response data to this callback endpoint after processing.'
            : 'The external provider can POST event data to the callback URL below.'}
          disabledDescription={isInternal
            ? 'Response callbacks are off. The integration operates in synchronous request-response mode only.'
            : 'No inbound data will be accepted. The callback URL is inactive.'}
        />
      </Card>

      {/* ── Callback endpoint ──────────────────────────────────────────────── */}
      <Card
        title="Callback endpoint"
        subtitle={isInternal
          ? 'Internal URL where the backend API delivers async responses for this integration.'
          : "URL to register in the provider's webhook settings so it knows where to send notifications."}>
        <div className="space-y-4">
          <div>
            <FieldLabel
              label="Callback URL (read-only)"
              hint="This URL is derived from the integration ID. To customise the path, update externalProviderCallbackPath in the registry." />
            <div className="flex items-center gap-2 bg-gray-50 border rounded-lg px-3 py-2">
              <code className="flex-1 text-sm font-mono text-gray-800 break-all">{webhookUrl}</code>
              <CopyBtn text={webhookUrl} />
            </div>
          </div>

          <div>
            <FieldLabel
              label="HTTP method"
              hint="The HTTP verb this endpoint expects to receive. POST is the standard for webhooks and async callbacks." />
            <select value={httpMethod} onChange={e => setHttpMethod(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-36">
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="GET">GET</option>
            </select>
          </div>
        </div>
      </Card>

      {/* ── Field mapping ──────────────────────────────────────────────────── */}
      <Card
        title="Expected field mapping"
        subtitle="Maps incoming field names to the PSP's internal names. Leave the target blank to use the source name unchanged. Use dot notation for nested values: payload.transaction.amount">
        <FieldMappingMatrix
          rules={inboundRules}
          setRules={setInboundRules}
          sourceLabel="Sender field"
          targetLabel="the PSP maps to" />
      </Card>

      {/* ── Security ───────────────────────────────────────────────────────── */}
      <Card
        title="Security; sender verification"
        subtitle="Validates each incoming request with a cryptographic signature. Without this, any HTTP client that knows the callback URL can send data.">
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={secEnabled} onChange={e => setSecEnabled(e.target.checked)}
              className="rounded border-gray-300" />
            <div className="flex items-center gap-1.5">
              {secEnabled ? <Shield size={14} className="text-green-600" /> : <ShieldOff size={14} className="text-gray-400" />}
              <span className={`text-sm font-medium ${secEnabled ? 'text-green-700' : 'text-gray-500'}`}>
                {secEnabled ? 'Signature verification enabled' : 'Signature verification disabled; any caller will be accepted'}
              </span>
            </div>
          </label>

          {secEnabled && (
            <div className="border-t pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel
                  label="Algorithm"
                  hint="Hash function used to compute the HMAC signature. SHA-256 is the most common. Use SHA-512 for higher security." />
                <select value={algorithm} onChange={e => setAlgorithm(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="sha256">HMAC-SHA256</option>
                  <option value="sha512">HMAC-SHA512</option>
                  <option value="sha1">HMAC-SHA1 (legacy)</option>
                </select>
              </div>
              <div>
                <FieldLabel
                  label="Signature header"
                  hint="The HTTP request header that contains the signature sent by the caller. Common values: X-Hub-Signature-256, X-Signature, X-Webhook-Signature." />
                <input value={sigHeader} onChange={e => setSigHeader(e.target.value)}
                  placeholder="X-Signature-256"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <FieldLabel
                  label="Signature prefix"
                  hint="Text that the sender prepends to the signature value in the header (e.g. 'sha256='). The PSP strips this before comparing. Leave blank if the header contains the raw signature." />
                <input value={sigPrefix} onChange={e => setSigPrefix(e.target.value)}
                  placeholder="sha256="
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
              </div>
              <div>
                <FieldLabel
                  label="Signature encoding"
                  hint="How the sender encodes the HMAC bytes. Hex (lowercase hexadecimal) is the most common. Base64 is used by some providers such as Stripe." />
                <select value={payloadFormat} onChange={e => setPayloadFormat(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="hex">Hex</option>
                  <option value="base64">Base64</option>
                </select>
              </div>
              <div>
                <FieldLabel
                  label="Replay window (seconds)"
                  hint="Requests with a timestamp older than this window are rejected to prevent replay attacks. Requires the sender to include a timestamp header. Recommended: 300 s (5 min)." />
                <input type="number" value={replayWindow} onChange={e => setReplayWindow(parseInt(e.target.value))}
                  min={60} max={3600}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ── Advanced options ───────────────────────────────────────────────── */}
      <Card title="Advanced options">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel
              label="Max payload size (KB)"
              hint="Requests whose body exceeds this size are rejected with HTTP 413 Payload Too Large. Use this to prevent abuse or oversized data." />
            <input type="number" value={maxPayloadKb} onChange={e => setMaxPayloadKb(parseInt(e.target.value))}
              min={1} max={10240}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <FieldLabel
              label="IP allowlist (optional)"
              hint="Only requests originating from these IP addresses or CIDR ranges will be accepted. Leave blank to allow requests from any origin. Separate multiple entries with commas." />
            <input value={ipAllowlist} onChange={e => setIpAllowlist(e.target.value)}
              placeholder="192.168.1.0/24, 10.0.0.1"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
          </div>
          <div className="flex items-start gap-3 sm:col-span-2">
            <input type="checkbox" id="enforceJson" checked={enforceJson}
              onChange={e => setEnforceJson(e.target.checked)}
              className="rounded border-gray-300 mt-0.5" />
            <label htmlFor="enforceJson" className="text-sm text-gray-700 cursor-pointer">
              Enforce <code className="bg-gray-100 px-1 rounded text-xs">Content-Type: application/json</code>
              <span className="block text-xs text-gray-400 mt-0.5">
                Reject requests that do not declare their body as JSON. Recommended to prevent accidental form-encoded or plain-text payloads.
              </span>
            </label>
          </div>
        </div>
      </Card>

      <SaveBtn saving={saving} saved={saved} onClick={handleSave} />

      {/* ── Test inbound reception ─────────────────────────────────────────── */}
      <Card
        title="Test inbound reception"
        subtitle="Validate Params previews the inbound field mapping without executing. Run Test performs a real reception and records a callback event in the Events tab.">
        <div className="space-y-4">

          {!callbackEnabled && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <Info size={13} className="mt-0.5 shrink-0 text-amber-600" />
              <p>Inbound reception is <strong>disabled</strong>. Enable it in the Inbound status section above to validate or run a test.</p>
            </div>
          )}

          {/* Test target URL (override) */}
          <div>
            <FieldLabel
              label="Receiving URL (optional override)"
              hint="Defaults to this integration's callback URL. You can point the test at a different path without changing the saved configuration." />
            <input
              value={overrideUrl}
              onChange={e => setOverrideUrl(e.target.value)}
              placeholder={webhookUrl}
              className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 ${endpointInfo.valid ? 'border-gray-300 focus:ring-amber-400' : 'border-red-400 bg-red-50'}`} />
            {!endpointInfo.valid && (
              <p className="mt-1 text-xs text-red-600">Enter an absolute URL (https://…) or an internal path starting with /.</p>
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
              label="Incoming payload"
              hint="Simulated JSON body that an external provider would POST to the callback URL. Edit it to test different scenarios." />
            <JsonEditor
              value={inboundSample}
              onChange={(v) => { setInboundSample(v); setInboundSampleError(''); }}
              error={inboundSampleError ? `Invalid JSON; ${inboundSampleError}` : null}
              minHeight="14rem"
              maxHeight="28rem" />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleValidateInbound}
              disabled={inboundTesting || !!inboundSampleError || !callbackEnabled}
              title={!callbackEnabled ? 'Enable inbound reception to test it' : undefined}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-amber-400 text-amber-700 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
              <FlaskConical size={12} className={inboundTesting ? 'animate-spin' : ''} />
              {inboundTesting ? 'Validating…' : 'Validate Params'}
            </button>
            <button
              onClick={handleRunInbound}
              disabled={running || !!inboundSampleError || !endpointInfo.valid || !callbackEnabled}
              title={!callbackEnabled ? 'Enable inbound reception to run a test' : undefined}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] hover:bg-[#00ED64] hover:text-[#001E2B] disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-semibold">
              <Play size={12} />
              {running ? 'Running…' : 'Run Test'}
            </button>
          </div>

          {inboundTestError && <p className="text-xs text-red-600">⚠ {inboundTestError}</p>}

          {/* Validate Params result */}
          {inboundTestResult && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600">
                Validate Params: {inboundTestResult.appliedRules} mapping rule{inboundTestResult.appliedRules !== 1 ? 's' : ''} applied
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Received from provider</p>
                  <JsonView data={inboundTestResult.original} maxHeight="13rem" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Processed by the PSP (after mapping)</p>
                  <JsonView data={inboundTestResult.transformed} maxHeight="13rem" />
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
                <span className="text-gray-400">{runResult.latencyMs} ms</span>
              </div>
              {runResult.error && <p className="text-xs text-red-600">⚠ {runResult.error}</p>}
              <div>
                <p className="text-xs text-gray-500 mb-1">Processed payload (recorded as a callback event)</p>
                <JsonView data={runResult.transformed} maxHeight="13rem" />
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

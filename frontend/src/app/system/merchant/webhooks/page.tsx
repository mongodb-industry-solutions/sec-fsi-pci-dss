'use client';
import { useEffect, useState } from 'react';
import { Webhook, Check, Send, Eye, EyeOff } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { useRequireActiveMerchant } from '../../../../lib/merchantContext';
import { api } from '../../../../lib/api';
import { JsonEditor } from '../../../../components/json/JsonEditor';
import { JsonView } from '../../../../components/json/JsonView';

type TestResult = Awaited<ReturnType<typeof api.merchants.testWebhook>>;

// Representative default payload (same shape the merchant receives on a real payment.completed).
function buildSample(merchantId: string) {
  return {
    event: 'payment.completed',
    result: 'approved',
    test: true,
    cardToken: 'tok_test000000000000',
    maskedPan: '****-****-****-4242',
    responseCode: '0000',
    authorizationCode: 'TEST01',
    amount: 49.99,
    currency: 'USD',
    merchantReference: 'TEST-ORDER-0001',
    merchantAgreementInstanceReference: merchantId,
    transactionId: '00000000-0000-4000-8000-000000000000',
    cardTransactionInstanceReference: '00000000-0000-4000-8000-000000000000',
  };
}

export default function WebhooksSectionPage() {
  const { token, merchant, refresh } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';
  const [url, setUrl] = useState(merchant?.merchantWebhookEndpoint ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  // Editable test payload + optional auth header (the scheme the merchant's endpoint expects).
  const [payloadText, setPayloadText] = useState('');
  const [authName, setAuthName] = useState('');
  const [authValue, setAuthValue] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Pre-fill the editable payload once the merchant id is known.
  useEffect(() => {
    if (merchantId && !payloadText) setPayloadText(JSON.stringify(buildSample(merchantId), null, 2));
  }, [merchantId, payloadText]);

  if (!merchant) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    setSaving(true);
    try {
      const r = await api.merchants.registerWebhook(merchantId, url, token);
      setSaved(true);
      if (r.merchantWebhookSecret) { setSecret(r.merchantWebhookSecret); setShowSecret(true); }
      refresh();
      setTimeout(() => setSaved(false), 3000);
    } catch {}
    setSaving(false);
  }

  const payloadInvalid = (() => { try { if (payloadText.trim()) JSON.parse(payloadText); return false; } catch { return true; } })();

  async function sendTest() {
    setTesting(true); setTestResult(null); setTestError(null);
    let payload: Record<string, unknown> | undefined;
    if (payloadText.trim()) {
      try { payload = JSON.parse(payloadText); }
      catch { setTestError('The payload is not valid JSON.'); setTesting(false); return; }
    }
    const authHeader = authName.trim() && authValue.trim() ? { name: authName.trim(), value: authValue.trim() } : undefined;
    try {
      setTestResult(await api.merchants.testWebhook(merchantId, token, { payload, authHeader }));
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'Failed to send test webhook.');
    }
    setTesting(false);
  }

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <SectionHeader
        icon={Webhook}
        title="Webhook"
        description="Endpoint for payment event notifications."
        debugInfo="BIAN SD-89 · PCI DSS Req 12.8 (managed integration endpoint) · HMAC-signed (Req 10.7)"
      />

      {/* Endpoint + signing secret */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Webhook Endpoint URL</label>
            <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com/webhooks/psp"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
            <Webhook size={15} />{saving ? 'Saving...' : 'Save Webhook'}
          </button>
          {saved && (
            <div className="flex items-center gap-1.5 text-sm text-green-700">
              <Check size={14} /> Webhook endpoint saved (a signing secret is ensured automatically).
            </div>
          )}
        </form>

        {secret && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-amber-800">Signing secret (verify the <code className="font-mono">X-Webhook-Signature</code> header)</p>
              <button onClick={() => setShowSecret((s) => !s)} className="text-amber-600 hover:text-amber-800">
                {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <p className="font-mono text-xs text-amber-900 break-all">{showSecret ? secret : '•'.repeat(Math.min(secret.length, 40))}</p>
            <p className="text-[11px] text-amber-700">Signature = <code className="font-mono">sha256=HMAC-SHA256(rawBody, secret)</code>. Store it securely.</p>
          </div>
        )}
      </div>

      {/* Test webhook — editable payload + optional auth header, no real payment needed */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5"><Send size={14} /> Test your endpoint</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Sends a simulated <code className="font-mono">payment.completed</code> webhook (HMAC-signed, marked
            <code className="font-mono"> test:true</code>) to your saved endpoint. Edit the payload below; no real payment is made.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="block text-xs text-gray-500 mb-1">Payload (editable JSON)</label>
            <button type="button" onClick={() => setPayloadText(JSON.stringify(buildSample(merchantId), null, 2))}
              className="text-[11px] text-[#001E2B] hover:underline">Reset to sample</button>
          </div>
          <JsonEditor value={payloadText} onChange={setPayloadText} minHeight="12rem" maxHeight="22rem"
            error={payloadInvalid ? 'Invalid JSON' : null} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Auth header name (optional)</label>
            <input value={authName} onChange={(e) => setAuthName(e.target.value)}
              placeholder="e.g. Authorization or X-API-Key"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Auth header value (optional)</label>
            <input value={authValue} onChange={(e) => setAuthValue(e.target.value)}
              placeholder="e.g. Bearer lbpk_live_… (paste an API key from API Keys)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
        </div>
        <p className="text-[11px] text-gray-400">
          The webhook is always HMAC-signed (<code className="font-mono">X-Webhook-Signature</code>). Add an auth header here if
          your endpoint expects the scheme/key you configured under <span className="font-medium">API Keys</span>.
        </p>

        <button onClick={sendTest} disabled={testing || !url}
          className="flex items-center gap-2 border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 text-sm">
          <Send size={15} />{testing ? 'Sending...' : 'Send test webhook'}
        </button>

        {testError && <p className="text-xs text-red-600">{testError}</p>}

        {testResult && testResult.configured === false && (
          <p className="text-xs text-amber-700">Save a webhook endpoint above before sending a test.</p>
        )}

        {testResult && testResult.configured && (
          <div className="space-y-3 border-t border-gray-100 pt-3">
            <div className={`flex items-center gap-2 text-sm font-medium ${testResult.delivered ? 'text-green-700' : 'text-red-600'}`}>
              {testResult.delivered ? <Check size={15} /> : <span>⚠</span>}
              {testResult.delivered ? 'Delivered' : 'Not delivered'}
              {typeof testResult.statusCode === 'number' && <span className="text-gray-500 font-normal">· HTTP {testResult.statusCode}</span>}
              <span className="text-gray-400 font-normal">· {testResult.attempts} attempt(s)</span>
            </div>
            {testResult.error && <p className="text-xs text-red-600">{testResult.error}</p>}
            <div>
              <p className="text-xs text-gray-500 mb-1">Request — POST {String(testResult.endpoint ?? '')}</p>
              <JsonView data={{ headers: testResult.requestHeaders, body: testResult.payload }} maxHeight="14rem" collapsed={3} />
            </div>
            {testResult.response !== undefined && testResult.response !== null && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Merchant response</p>
                <JsonView data={testResult.response} maxHeight="12rem" collapsed={3} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

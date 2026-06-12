'use client';
import { useState } from 'react';
import { Copy, Check, Key, ShieldCheck } from 'lucide-react';
import { useRequireActiveMerchant } from '../../../../lib/merchantContext';
import { api } from '../../../../lib/api';

export default function ApiKeysSectionPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';
  const [result, setResult] = useState<{ merchantApiKey: string; keyId: string; keyPrefix: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!merchant) return null;

  async function generate() {
    setLoading(true); setResult(null);
    try { setResult(await api.merchants.generateKey(merchantId, token)); } catch {}
    setLoading(false);
  }

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">API Keys</h1>
        <p className="text-sm text-gray-500 mt-0.5">Server-to-server credential for the gateway API. BIAN SD-89.</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 flex items-start gap-2">
        <ShieldCheck size={14} className="text-amber-600 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-700">
          PCI DSS Req 3: the plaintext key is shown <strong>once</strong> at creation; only a bcrypt hash is stored. Save it immediately — it cannot be retrieved again.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <button onClick={generate} disabled={loading}
          className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
          <Key size={15} />{loading ? 'Generating...' : 'Generate API Key'}
        </button>

        {result && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
            <div className="text-sm font-medium text-green-800">New API key (copy it now):</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 font-mono text-xs text-green-700 bg-white border border-green-200 rounded px-2 py-1.5 truncate">{result.merchantApiKey}</div>
              <button onClick={() => { navigator.clipboard.writeText(result.merchantApiKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="shrink-0 p-1.5 rounded hover:bg-green-100">
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-green-600" />}
              </button>
            </div>
            <div className="text-xs text-green-600 font-mono">Key ID: {result.keyId} · Prefix: {result.keyPrefix}</div>
          </div>
        )}
      </div>
    </div>
  );
}

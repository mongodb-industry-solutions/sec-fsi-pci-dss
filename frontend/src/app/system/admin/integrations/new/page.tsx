'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';

const TYPE_OPTIONS = [
  { value: 'fraud_detection', label: 'Fraud Detection',  hint: 'SD-63' },
  { value: 'hrp_sanctions',   label: 'HRP / Sanctions',  hint: 'SD-13' },
  { value: 'kyc_identity',    label: 'KYC / Identity',   hint: 'SD-53' },
  { value: 'kyb_business',    label: 'KYB / Business',   hint: 'SD-89' },
  { value: 'aml_monitoring',  label: 'AML Monitoring',   hint: 'SD-99' },
  { value: 'credit_bureau',   label: 'Credit Bureau',    hint: 'SD-83' },
];

export default function NewIntegrationPage() {
  const router = useRouter();
  const token = getToken() ?? '';

  const [form, setForm] = useState({
    name: '',
    type: 'fraud_detection',
    mode: 'sync',
    endpoint: '',
    callbackUrl: '',
    status: 'test',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);

  function set(k: keyof typeof form, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Provider name is required.'); return; }
    if (!form.endpoint.trim()) { setError('API endpoint is required.'); return; }
    setError('');
    setSaving(true);
    try {
      const body: Record<string, string> = {
        externalProviderArrangementName: form.name.trim(),
        externalProviderArrangementType: form.type,
        externalProviderMode:            form.mode,
        externalProviderApiEndpoint:     form.endpoint.trim(),
        externalProviderArrangementStatus: form.status,
      };
      if (form.callbackUrl.trim()) body.externalProviderCallbackUrl = form.callbackUrl.trim();

      const r = await api.integrations.create(body, token);
      const d = r as { integration: { externalProviderArrangementInstanceReference: string }; apiKey?: string };
      setNewKey(d.apiKey ?? null);
      setNewId(d.integration.externalProviderArrangementInstanceReference);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to register provider.');
    } finally {
      setSaving(false);
    }
  }

  if (newKey && newId) {
    return (
      <div className="w-full px-5 sm:px-8 lg:px-12 py-6 flex justify-center">
        <div className="w-full max-w-lg bg-white rounded-2xl border shadow-sm p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 bg-green-100 rounded-lg"><KeyRound size={18} className="text-green-700" /></div>
            <h1 className="text-lg font-bold text-gray-900">Provider registered</h1>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Copy the API key below and store it securely. It will <strong>not</strong> be shown again.
          </p>
          <code className="block w-full bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm font-mono text-amber-900 break-all select-all mb-4">
            {newKey}
          </code>
          <div className="flex gap-3">
            <Link
              href={`/system/admin/integrations/${newId}`}
              className="flex-1 text-center text-sm px-4 py-2.5 rounded-lg bg-[#001E2B] text-[#00ED64] font-medium hover:opacity-90 transition-opacity"
            >
              View Integration
            </Link>
            <Link
              href="/system/admin/integrations"
              className="flex-1 text-center text-sm px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:border-gray-500 transition-colors"
            >
              All Integrations
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6">
        <div className="mb-5">
          <Link href="/system/admin/integrations" className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors w-fit">
            <ArrowLeft size={12} />
            All Integrations
          </Link>
          <h1 className="text-xl font-bold text-gray-900 mt-2">Register Provider</h1>
          <p className="text-sm text-gray-500 mt-0.5">Add an external service provider to the SD-193 Integration Registry.</p>
        </div>

        <form onSubmit={handleSubmit} className="max-w-xl bg-white rounded-xl border p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Provider Name *</label>
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Sardine Fraud API"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30 focus:border-[#001E2B]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Integration Type *</label>
            <select
              value={form.type}
              onChange={e => set('type', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30 focus:border-[#001E2B]"
            >
              {TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label} ({o.hint})</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Mode *</label>
              <select
                value={form.mode}
                onChange={e => set('mode', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30 focus:border-[#001E2B]"
              >
                <option value="sync">Synchronous</option>
                <option value="async">Asynchronous</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Initial Status</label>
              <select
                value={form.status}
                onChange={e => set('status', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30 focus:border-[#001E2B]"
              >
                <option value="test">Test (inactive)</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">API Endpoint *</label>
            <input
              value={form.endpoint}
              onChange={e => set('endpoint', e.target.value)}
              placeholder="https://api.provider.com/v1/score"
              type="url"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30 focus:border-[#001E2B]"
            />
          </div>

          {form.mode === 'async' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Callback URL (optional)</label>
              <input
                value={form.callbackUrl}
                onChange={e => set('callbackUrl', e.target.value)}
                placeholder="https://back.es/webhooks/fds/:id/callback"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/30 focus:border-[#001E2B]"
              />
              <p className="text-xs text-gray-400 mt-1">LeafyBank&apos;s inbound HMAC-validated webhook URL for this provider type.</p>
            </div>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 text-sm px-4 py-2.5 rounded-lg bg-[#001E2B] text-[#00ED64] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Registering…' : 'Register Provider'}
            </button>
            <Link
              href="/system/admin/integrations"
              className="text-sm px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:border-gray-500 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
    </div>
  );
}

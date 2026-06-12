'use client';
import { useState } from 'react';
import { Webhook, Check } from 'lucide-react';
import { useRequireActiveMerchant } from '../../../../lib/merchantContext';
import { api } from '../../../../lib/api';

export default function WebhooksSectionPage() {
  const { token, merchant, refresh } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';
  const [url, setUrl] = useState(merchant?.merchantWebhookEndpoint ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!merchant) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    setSaving(true);
    try {
      await api.merchants.registerWebhook(merchantId, url, token);
      setSaved(true);
      refresh();
      setTimeout(() => setSaved(false), 3000);
    } catch {}
    setSaving(false);
  }

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Webhook</h1>
        <p className="text-sm text-gray-500 mt-0.5">Endpoint that receives payment event notifications. BIAN SD-89.</p>
      </div>

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
              <Check size={14} /> Webhook endpoint saved.
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

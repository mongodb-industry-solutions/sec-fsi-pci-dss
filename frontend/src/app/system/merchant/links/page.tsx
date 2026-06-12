'use client';
import { useCallback, useEffect, useState } from 'react';
import { Copy, Check, ExternalLink, Trash2 } from 'lucide-react';
import { useRequireActiveMerchant } from '../../../../lib/merchantContext';
import { api } from '../../../../lib/api';

interface PaymentLink {
  paymentLinkInstanceReference: string;
  paymentLinkCode: string;
  paymentLinkAmount: number;
  paymentLinkCurrency: string;
  paymentLinkDescription: string;
  paymentLinkStatus: string;
  paymentLinkUsageType: string;
  paymentLinkCurrentUses: number;
}

export default function LinksSectionPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';

  const [amount, setAmount] = useState('49.99');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('Consulting Session');
  const [message, setMessage] = useState('');
  const [usageType, setUsageType] = useState<'single_use' | 'multi_use'>('single_use');
  const [result, setResult] = useState<{ paymentUrl: string; paymentLinkCode: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);

  const loadLinks = useCallback(async () => {
    if (!merchantId) return;
    setLoadingLinks(true);
    try {
      const res = await api.paymentLinks.list(merchantId, token);
      setLinks(res.results as unknown as PaymentLink[]);
    } catch { setLinks([]); }
    setLoadingLinks(false);
  }, [merchantId, token]);

  useEffect(() => { if (merchantId) loadLinks(); }, [merchantId, loadLinks]);

  if (!merchant) return null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await api.paymentLinks.create({
        merchantAgreementInstanceReference: merchantId,
        amount: parseFloat(amount), currency, description,
        customerMessage: message || undefined, usageType,
      }, token);
      setResult(res);
      loadLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create link.');
    }
    setLoading(false);
  }

  async function deactivate(id: string) {
    try { await api.paymentLinks.deactivate(id, merchantId, token); loadLinks(); } catch {}
  }

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Payment Links</h1>
        <p className="text-sm text-gray-500 mt-0.5">Shareable URL for email, QR codes, or social media. BIAN SD-64 Payment Order.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <form onSubmit={create} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Amount</label>
              <input required type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Currency</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
                {(merchant.merchantAllowedCurrencies ?? ['USD', 'EUR', 'GBP']).map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description</label>
            <input required type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Customer Message (optional)</label>
            <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message shown to buyer"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Usage Type</label>
            <select value={usageType} onChange={(e) => setUsageType(e.target.value as 'single_use' | 'multi_use')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
              <option value="single_use">Single Use (invoice / one-time)</option>
              <option value="multi_use">Multi Use (store / recurring)</option>
            </select>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <button type="submit" disabled={loading}
            className="w-full bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
            {loading ? 'Creating...' : 'Create Payment Link'}
          </button>
        </form>

        {result && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
            <div className="text-sm font-medium text-green-800">Payment link created. Share this URL:</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 font-mono text-xs text-green-700 bg-white border border-green-200 rounded px-2 py-1.5 truncate">{result.paymentUrl}</div>
              <button onClick={() => { navigator.clipboard.writeText(result.paymentUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="shrink-0 p-1.5 rounded hover:bg-green-100">
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-green-600" />}
              </button>
              <a href={result.paymentUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 p-1.5 rounded hover:bg-green-100">
                <ExternalLink size={14} className="text-green-600" />
              </a>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="font-medium text-gray-800 text-sm">Active Links</h3>
          <button onClick={loadLinks} className="text-xs text-[#00ED64] hover:underline">Refresh</button>
        </div>
        {loadingLinks ? (
          <div className="px-5 py-6 text-center text-sm text-gray-400">Loading...</div>
        ) : links.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-gray-400">No payment links yet.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {links.map((link) => (
              <li key={link.paymentLinkInstanceReference} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-600">{link.paymentLinkCode}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      link.paymentLinkStatus === 'active' ? 'bg-green-100 text-green-700' :
                      link.paymentLinkStatus === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>{link.paymentLinkStatus}</span>
                    <span className="text-xs text-gray-400">{link.paymentLinkUsageType}</span>
                  </div>
                  <div className="text-sm text-gray-700 mt-0.5 truncate">{link.paymentLinkDescription}</div>
                  <div className="text-xs text-gray-400">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: link.paymentLinkCurrency }).format(link.paymentLinkAmount)}
                    {' · '}{link.paymentLinkCurrentUses} use{link.paymentLinkCurrentUses !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <a href={`/gateway/pay/${link.paymentLinkCode}`} target="_blank" rel="noopener noreferrer"
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700">
                    <ExternalLink size={13} />
                  </a>
                  {link.paymentLinkStatus === 'active' && (
                    <button onClick={() => deactivate(link.paymentLinkInstanceReference)}
                      className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

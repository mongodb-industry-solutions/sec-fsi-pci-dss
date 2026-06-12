'use client';
import { useState } from 'react';
import { Copy, Check, ExternalLink, ShoppingCart } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { useRequireActiveMerchant } from '../../../../lib/merchantContext';
import { api } from '../../../../lib/api';

export default function CheckoutSectionPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';

  const [amount, setAmount] = useState('99.00');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('Demo Order #1234');
  const [returnUrl, setReturnUrl] = useState('https://example.com/success');
  const [cancelUrl, setCancelUrl] = useState('https://example.com/cancel');
  const [reference, setReference] = useState('ORDER-001');
  const [result, setResult] = useState<{ paymentPageUrl: string; expiresAt: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  if (!merchant) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await api.checkout.createSession({
        merchantAgreementInstanceReference: merchantId,
        amount: parseFloat(amount), currency, description, returnUrl, cancelUrl, merchantReference: reference,
      }, token);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session.');
    }
    setLoading(false);
  }

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5 max-w-2xl">
      <SectionHeader
        icon={ShoppingCart}
        title="Checkout Session"
        description="Create a hosted checkout session for the buyer."
        debugInfo="BIAN SD-64 Payment Order · PCI DSS SAQ A / Req 3 (PAN not handled by the merchant site)"
      />

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <form onSubmit={submit} className="space-y-3">
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Return URL</label>
              <input type="url" value={returnUrl} onChange={(e) => setReturnUrl(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cancel URL</label>
              <input type="url" value={cancelUrl} onChange={(e) => setCancelUrl(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Merchant Reference</label>
            <input type="text" value={reference} onChange={(e) => setReference(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <button type="submit" disabled={loading}
            className="w-full bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-60 text-sm">
            {loading ? 'Creating...' : 'Create Checkout Session'}
          </button>
        </form>

        {result && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
            <div className="text-sm font-medium text-green-800">Session created. Redirect the buyer to:</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 font-mono text-xs text-green-700 bg-white border border-green-200 rounded px-2 py-1.5 truncate">{result.paymentPageUrl}</div>
              <button onClick={() => { navigator.clipboard.writeText(result.paymentPageUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="shrink-0 p-1.5 rounded hover:bg-green-100">
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-green-600" />}
              </button>
              <a href={result.paymentPageUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 p-1.5 rounded hover:bg-green-100">
                <ExternalLink size={14} className="text-green-600" />
              </a>
            </div>
            <div className="text-xs text-green-600">Expires: {new Date(result.expiresAt).toLocaleString()}</div>
          </div>
        )}
      </div>
    </div>
  );
}

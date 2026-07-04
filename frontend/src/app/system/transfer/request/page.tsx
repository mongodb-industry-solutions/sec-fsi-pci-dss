'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { QrCode, AlertCircle, Check, Copy } from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { Breadcrumb } from '../../../../components/Breadcrumb';
import { SectionHeader } from '../../../../components/SectionHeader';

interface MerchantOption {
  merchantAgreementInstanceReference: string;
  merchantName: string;
  merchantAgreementStatus: string;
  merchantAllowedCurrencies: string[];
}

const APPROVED_STATUSES = new Set(['agreed', 'active', 'amended']);

export default function RequestPaymentPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [role, setRole] = useState('');

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (t) setRole(decodeToken(t)?.role ?? '');
  }, []);

  if (role && role !== 'customer') {
    return (
      <div className="w-full px-5 sm:px-8 py-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          Access denied, this page is available to customers only.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Transfer', href: '/system/transfer' }, { label: 'Request payment' }]} />
      <SectionHeader icon={QrCode} title="Request payment" description="Create a shareable payment link" />

      {token && (
        <RequestForm token={token} onDone={() => router.push('/system/transfer')} />
      )}
    </div>
  );
}

function RequestForm({ token, onDone }: { token: string; onDone: () => void }) {
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [mLoaded, setMLoaded] = useState(false);
  const [merchantRef, setMerchantRef] = useState('');

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.merchants.list({}, token)
      .then(r => {
        const all = (r.results ?? []) as unknown as MerchantOption[];
        const approved = all.filter(m => APPROVED_STATUSES.has(m.merchantAgreementStatus));
        setMerchants(approved);
        if (approved.length > 0) {
          setMerchantRef(approved[0].merchantAgreementInstanceReference);
          const currencies = approved[0].merchantAllowedCurrencies;
          if (currencies?.length > 0) setCurrency(currencies[0]);
        }
        setMLoaded(true);
      })
      .catch(() => setMLoaded(true));
  }, [token]);

  const selectedMerchant = merchants.find(m => m.merchantAgreementInstanceReference === merchantRef);

  function handleMerchantChange(ref: string) {
    setMerchantRef(ref);
    const m = merchants.find(x => x.merchantAgreementInstanceReference === ref);
    if ((m?.merchantAllowedCurrencies?.length ?? 0) > 0) setCurrency(m!.merchantAllowedCurrencies![0]);
  }

  async function handleCreate() {
    const parsed = parseFloat(amount);
    if (!merchantRef || isNaN(parsed) || parsed <= 0 || !description.trim()) {
      setError('Enter a valid amount and description.'); return;
    }
    setSubmitting(true); setError('');
    try {
      const body: Parameters<typeof api.paymentLinks.create>[0] = {
        merchantAgreementInstanceReference: merchantRef,
        amount: parsed,
        currency,
        description: description.trim(),
        usageType: 'single_use',
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      };
      const res = await api.paymentLinks.create(body, token);
      setResult({ url: res.paymentUrl, code: res.paymentLinkCode });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create payment link.');
    }
    setSubmitting(false);
  }

  function handleCopy() {
    if (!result) return;
    navigator.clipboard.writeText(result.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!mLoaded) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">Loading…</div>
    );
  }

  if (merchants.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700 space-y-1">
          <p className="font-medium">No approved merchant account</p>
          <p className="text-xs">Payment links require an approved merchant agreement. Your account has no merchant with KYB approved, submit a merchant application or wait for your existing application to be reviewed.</p>
        </div>
        <Link href="/system/transfer"
          className="block w-full py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-center">
          Back
        </Link>
      </div>
    );
  }

  if (result) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="text-center py-4">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Check size={24} className="text-green-600" />
          </div>
          <p className="font-semibold text-gray-900">Payment link created</p>
          <p className="text-xs font-mono text-gray-500 mt-1">{result.code}</p>
        </div>
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700 break-all font-mono">
          {result.url}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleCopy}
            className="flex-1 py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg hover:bg-[#001E2B]/80 transition-colors flex items-center justify-center gap-1.5">
            <Copy size={14} />
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button type="button" onClick={onDone}
            className="flex-1 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Merchant</label>
        <select value={merchantRef} onChange={e => handleMerchantChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
          {merchants.map(m => (
            <option key={m.merchantAgreementInstanceReference} value={m.merchantAgreementInstanceReference}>
              {m.merchantName} ({m.merchantAgreementStatus})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
        <div className="flex gap-2">
          <input value={amount} onChange={e => setAmount(e.target.value)}
            type="number" min="0.01" step="0.01" placeholder="0.00"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          <select value={currency} onChange={e => setCurrency(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
            {(selectedMerchant?.merchantAllowedCurrencies?.length
              ? selectedMerchant.merchantAllowedCurrencies
              : ['USD', 'EUR', 'GBP', 'CAD', 'AUD']
            ).map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
        <input value={description} onChange={e => setDescription(e.target.value)} maxLength={200}
          placeholder="e.g. Invoice #1234, event ticket…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Expires <span className="text-gray-400">(optional)</span></label>
        <input value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
          type="datetime-local"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
      </div>

      {error && (
        <div className="flex items-start gap-2 text-red-600 bg-red-50 rounded-lg px-3 py-2 text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />{error}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Link href="/system/transfer"
          className="flex-1 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-center">
          Cancel
        </Link>
        <button type="button" onClick={handleCreate} disabled={submitting}
          className="flex-1 py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg hover:bg-[#001E2B]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {submitting ? 'Creating…' : 'Create link'}
        </button>
      </div>
    </div>
  );
}

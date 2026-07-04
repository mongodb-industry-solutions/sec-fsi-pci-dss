'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { QrCode, AlertCircle, Check, Copy } from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { Breadcrumb } from '../../../../components/Breadcrumb';
import { SectionHeader } from '../../../../components/SectionHeader';

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
          Access denied — this page is available to customers only.
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
  const [merchantRef, setMerchantRef] = useState<string | null>(null);
  const [mLoaded, setMLoaded] = useState(false);

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.auth.me(token)
      .then(me => {
        const ref = (me as unknown as { merchant?: { id: string } }).merchant?.id ?? null;
        setMerchantRef(ref);
        setMLoaded(true);
      })
      .catch(() => setMLoaded(true));
  }, [token]);

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

  if (!merchantRef) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700 space-y-1">
          <p className="font-medium">Merchant account required</p>
          <p className="text-xs">Payment links are scoped to a merchant agreement. Your account does not have a linked merchant — request this via a merchant application.</p>
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
        <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
        <div className="flex gap-2">
          <input value={amount} onChange={e => setAmount(e.target.value)}
            type="number" min="0.01" step="0.01" placeholder="0.00"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          <select value={currency} onChange={e => setCurrency(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
            {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map(c => <option key={c}>{c}</option>)}
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

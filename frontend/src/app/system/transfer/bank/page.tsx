'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Landmark, AlertCircle, Check } from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { fmtAmount, useAccountsAndBeneficiaries } from '../_shared';
import { Breadcrumb } from '../../../../components/Breadcrumb';
import { SectionHeader } from '../../../../components/SectionHeader';

export default function BankTransferPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [partyRef, setPartyRef] = useState('');
  const [role, setRole] = useState('');

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (t) {
      const u = decodeToken(t);
      setPartyRef(u?.partyRef ?? u?.sub ?? '');
      setRole(u?.role ?? '');
    }
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
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Transfer', href: '/system/transfer' }, { label: 'Bank transfer' }]} />
      <SectionHeader icon={Landmark} title="Bank transfer" description="Transfer to a bank account" />

      {token && partyRef && (
        <BankForm partyRef={partyRef} token={token} onDone={() => router.push('/system/transfer')} />
      )}
    </div>
  );
}

function BankForm({ partyRef, token, onDone }: { partyRef: string; token: string; onDone: () => void }) {
  const [tab, setTab] = useState<'saved' | 'new'>('saved');
  const { beneficiaries, bLoaded, accounts, aLoaded, fromAccountRef, setFromAccountRef, beneficiaryRef, setBeneficiaryRef } =
    useAccountsAndBeneficiaries(partyRef, token);

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ ref: string; amount: number; currency: string } | null>(null);

  const selectedAccount = accounts.find(a => a.payoutAccountInstanceReference === fromAccountRef);

  async function handleSend() {
    const parsed = parseFloat(amount);
    if (!fromAccountRef || !beneficiaryRef || isNaN(parsed) || parsed <= 0) {
      setError('Select a recipient, account and enter a valid amount.'); return;
    }
    setSending(true); setError('');
    try {
      const res = await api.beneficiaries.transfer(
        partyRef, beneficiaryRef,
        { fromAccountRef, amount: parsed, note: note.trim() || undefined },
        token,
      );
      setSuccess({ ref: res.transferReference, amount: parsed, currency: res.currency });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed.');
    }
    setSending(false);
  }

  if (success) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 max-w-lg">
        <div className="text-center py-4">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Check size={24} className="text-green-600" />
          </div>
          <p className="font-semibold text-gray-900">{fmtAmount(success.amount, success.currency)} sent</p>
          <p className="text-xs font-mono text-gray-400 mt-2">Ref: {success.ref.slice(0, 8)}…</p>
        </div>
        <button type="button" onClick={onDone}
          className="w-full py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg hover:bg-[#001E2B]/80 transition-colors">
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
        {(['saved', 'new'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`flex-1 py-1.5 transition-colors ${tab === t ? 'bg-[#001E2B] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            {t === 'saved' ? 'Saved recipient' : 'New IBAN'}
          </button>
        ))}
      </div>

      {tab === 'new' ? (
        <>
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700 space-y-1">
            <p className="font-medium">Bank wire coming soon</p>
            <p className="text-xs">Direct IBAN transfers require a separate payment rail. To send to a new recipient, add them as a contact on the <Link href="/system/beneficiaries" className="font-medium underline">Beneficiaries</Link> page first.</p>
          </div>
          <Link href="/system/transfer"
            className="block w-full py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-center">
            Back
          </Link>
        </>
      ) : (
        <>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Send to</label>
            {!bLoaded ? (
              <div className="text-xs text-gray-400">Loading contacts…</div>
            ) : beneficiaries.length === 0 ? (
              <div className="text-xs text-amber-600">No saved contacts. <Link href="/system/beneficiaries" className="underline">Add one from the Beneficiaries page.</Link></div>
            ) : (
              <select value={beneficiaryRef} onChange={e => setBeneficiaryRef(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
                {beneficiaries.map(b => (
                  <option key={b.counterpartyArrangementReference} value={b.counterpartyArrangementReference}>
                    {b.counterpartyLabel} · {b.counterpartyLookupHint}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">From account</label>
            {!aLoaded ? (
              <div className="text-xs text-gray-400">Loading accounts…</div>
            ) : accounts.length === 0 ? (
              <div className="text-xs text-amber-600">No active payout accounts found.</div>
            ) : (
              <select value={fromAccountRef} onChange={e => setFromAccountRef(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
                {accounts.map(a => (
                  <option key={a.payoutAccountInstanceReference} value={a.payoutAccountInstanceReference}>
                    {a.payoutAccountIsDefault ? '★ ' : ''}{a.payoutAccountAlias || a.payoutAccountBankName || 'Account'} · {a.payoutAccountCurrency}
                  </option>
                ))}
              </select>
            )}
            {selectedAccount?.payoutAccountBalance && (
              <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                <Landmark size={11} />
                Available: <span className="font-medium text-gray-600">{fmtAmount(selectedAccount.payoutAccountBalance.availableAmount, selectedAccount.payoutAccountCurrency)}</span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
            <div className="flex gap-2">
              <input value={amount} onChange={e => setAmount(e.target.value)}
                type="number" min="0.01" step="0.01" placeholder="0.00"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              <span className="flex items-center px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-600">
                {selectedAccount?.payoutAccountCurrency ?? '—'}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Note <span className="text-gray-400">(optional)</span></label>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={140}
              placeholder="Payment reference…"
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
            <button type="button" onClick={handleSend} disabled={sending || beneficiaries.length === 0 || accounts.length === 0}
              className="flex-1 py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg hover:bg-[#001E2B]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {sending ? 'Sending…' : 'Transfer'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

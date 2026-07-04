'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Landmark, AlertCircle, Check, ArrowRight } from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { fmtAmount, PayoutAccountOption } from '../_shared';
import { Breadcrumb } from '../../../../components/Breadcrumb';
import { SectionHeader } from '../../../../components/SectionHeader';

type Tab = 'own' | 'external';

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
      <SectionHeader icon={Landmark} title="Bank transfer" description="Move funds between your accounts or send to an external bank account" />

      {token && partyRef && (
        <BankForm partyRef={partyRef} token={token} onDone={() => router.push('/system/transfer')} />
      )}
    </div>
  );
}

function BankForm({ partyRef, token, onDone }: { partyRef: string; token: string; onDone: () => void }) {
  const [tab, setTab] = useState<Tab>('own');

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium max-w-sm">
        {([['own', 'Between my accounts'], ['external', 'External bank account']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`flex-1 py-2 transition-colors ${tab === t ? 'bg-[#001E2B] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'own'
        ? <OwnAccountsForm partyRef={partyRef} token={token} onDone={onDone} />
        : <ExternalIbanForm onDone={onDone} />
      }
    </div>
  );
}

// ── Between own accounts ──────────────────────────────────────────────────────

function OwnAccountsForm({ partyRef, token, onDone }: { partyRef: string; token: string; onDone: () => void }) {
  const [accounts, setAccounts] = useState<PayoutAccountOption[]>([]);
  const [aLoaded, setALoaded] = useState(false);
  const [fromRef, setFromRef] = useState('');
  const [toRef, setToRef] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ from: string; to: string; amount: number; currency: string } | null>(null);

  useEffect(() => {
    api.accounts.list(partyRef, token, { status: 'active' })
      .then(r => {
        const accts = r.results as unknown as PayoutAccountOption[];
        setAccounts(accts);
        setALoaded(true);
        if (accts.length > 0) setFromRef(accts[0].payoutAccountInstanceReference);
        if (accts.length > 1) setToRef(accts[1].payoutAccountInstanceReference);
      })
      .catch(() => setALoaded(true));
  }, [partyRef, token]);

  const fromAccount = accounts.find(a => a.payoutAccountInstanceReference === fromRef);
  const toAccount = accounts.find(a => a.payoutAccountInstanceReference === toRef);
  const toOptions = accounts.filter(a => a.payoutAccountInstanceReference !== fromRef);

  function handleFromChange(ref: string) {
    setFromRef(ref);
    if (toRef === ref) {
      const other = accounts.find(a => a.payoutAccountInstanceReference !== ref);
      setToRef(other?.payoutAccountInstanceReference ?? '');
    }
  }

  async function handleTransfer() {
    const parsed = parseFloat(amount);
    if (!fromRef || !toRef || isNaN(parsed) || parsed <= 0) {
      setError('Select both accounts and enter a valid amount.'); return;
    }
    if (fromRef === toRef) { setError('Source and destination must be different accounts.'); return; }
    // Internal account-to-account transfer is not yet implemented in the backend.
    // Show a coming-soon message rather than silently failing.
    setError('Internal account-to-account transfers are not yet available. Please use "Send to contact" to transfer funds via a saved beneficiary.');
  }

  if (success) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="text-center py-4">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Check size={24} className="text-green-600" />
          </div>
          <p className="font-semibold text-gray-900">{fmtAmount(success.amount, success.currency)} transferred</p>
          <p className="text-xs text-gray-500 mt-1">{success.from} → {success.to}</p>
        </div>
        <button type="button" onClick={onDone}
          className="w-full py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg hover:bg-[#001E2B]/80 transition-colors">
          Done
        </button>
      </div>
    );
  }

  if (!aLoaded) {
    return <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">Loading accounts…</div>;
  }

  if (accounts.length < 2) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          <p className="font-medium">At least two accounts required</p>
          <p className="text-xs mt-0.5">You need at least two active payout accounts to transfer between them. <Link href="/system/accounts" className="underline font-medium">Manage your accounts.</Link></p>
        </div>
        <Link href="/system/transfer" className="block w-full py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-center">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      {/* From / To account selector */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
          <select value={fromRef} onChange={e => handleFromChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
            {accounts.map(a => (
              <option key={a.payoutAccountInstanceReference} value={a.payoutAccountInstanceReference}>
                {a.payoutAccountIsDefault ? '★ ' : ''}{a.payoutAccountAlias || a.payoutAccountBankName || 'Account'} · {a.payoutAccountCurrency}
              </option>
            ))}
          </select>
          {fromAccount?.payoutAccountBalance && (
            <p className="text-xs text-gray-400 mt-1">
              Available: <span className="font-medium text-gray-600">{fmtAmount(fromAccount.payoutAccountBalance.availableAmount, fromAccount.payoutAccountCurrency)}</span>
            </p>
          )}
        </div>

        <div className="pb-2">
          <ArrowRight size={16} className="text-gray-400" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
          <select value={toRef} onChange={e => setToRef(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
            {toOptions.map(a => (
              <option key={a.payoutAccountInstanceReference} value={a.payoutAccountInstanceReference}>
                {a.payoutAccountIsDefault ? '★ ' : ''}{a.payoutAccountAlias || a.payoutAccountBankName || 'Account'} · {a.payoutAccountCurrency}
              </option>
            ))}
          </select>
          {toAccount?.payoutAccountBalance && (
            <p className="text-xs text-gray-400 mt-1">
              Balance: <span className="font-medium text-gray-600">{fmtAmount(toAccount.payoutAccountBalance.availableAmount, toAccount.payoutAccountCurrency)}</span>
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
        <div className="flex gap-2">
          <input value={amount} onChange={e => setAmount(e.target.value)}
            type="number" min="0.01" step="0.01" placeholder="0.00"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          <span className="flex items-center px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-600">
            {fromAccount?.payoutAccountCurrency ?? '—'}
          </span>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Note <span className="text-gray-400">(optional)</span></label>
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={140}
          placeholder="e.g. Monthly savings transfer…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
      </div>

      {error && (
        <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />{error}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Link href="/system/transfer"
          className="flex-1 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-center">
          Cancel
        </Link>
        <button type="button" onClick={handleTransfer}
          className="flex-1 py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg hover:bg-[#001E2B]/80 transition-colors">
          Transfer
        </button>
      </div>
    </div>
  );
}

// ── External IBAN ─────────────────────────────────────────────────────────────

interface IbanForm {
  iban: string;
  bic: string;
  holderName: string;
  bankName: string;
  amount: string;
  currency: string;
  reference: string;
  save: boolean;
}

function ExternalIbanForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState<IbanForm>({
    iban: '', bic: '', holderName: '', bankName: '',
    amount: '', currency: 'EUR', reference: '', save: false,
  });
  const [error] = useState('');

  function set(field: keyof IbanForm, value: string | boolean) {
    setForm(f => ({ ...f, [field]: value }));
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700 space-y-1">
        <p className="font-medium">Wire transfer, coming soon</p>
        <p className="text-xs">Direct IBAN wire transfers require a live payment rail integration. You can fill in the details and save the account for when this feature becomes available.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">IBAN</label>
          <input value={form.iban} onChange={e => set('iban', e.target.value.toUpperCase().replace(/\s/g, ''))}
            placeholder="e.g. DE89370400440532013000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">BIC / SWIFT</label>
          <input value={form.bic} onChange={e => set('bic', e.target.value.toUpperCase())}
            placeholder="e.g. DEUTDEDB"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Account holder name</label>
          <input value={form.holderName} onChange={e => set('holderName', e.target.value)}
            placeholder="Full legal name"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Bank name <span className="text-gray-400">(optional)</span></label>
          <input value={form.bankName} onChange={e => set('bankName', e.target.value)}
            placeholder="e.g. Deutsche Bank"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
          <div className="flex gap-2">
            <input value={form.amount} onChange={e => set('amount', e.target.value)}
              type="number" min="0.01" step="0.01" placeholder="0.00"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            <select value={form.currency} onChange={e => set('currency', e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
              {['EUR', 'USD', 'GBP', 'CHF', 'CAD'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Payment reference <span className="text-gray-400">(optional)</span></label>
          <input value={form.reference} onChange={e => set('reference', e.target.value)} maxLength={140}
            placeholder="e.g. Invoice #1234"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={form.save} onChange={e => set('save', e.target.checked)}
          className="rounded border-gray-300 text-[#00ED64] focus:ring-[#00ED64]/40" />
        <span className="text-xs text-gray-600">Save this account to my payout accounts for future transfers</span>
      </label>

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
        <button type="button" disabled
          className="flex-1 py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg opacity-40 cursor-not-allowed">
          Send wire
        </button>
      </div>
    </div>
  );
}

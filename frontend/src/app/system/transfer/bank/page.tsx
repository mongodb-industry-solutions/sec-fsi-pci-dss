'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Landmark, AlertCircle, Check, ArrowRight, Info } from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { fmtAmount, PayoutAccountOption, Beneficiary } from '../_shared';
import { Breadcrumb } from '../../../../components/Breadcrumb';
import { SectionHeader } from '../../../../components/SectionHeader';

// ── Tooltip ───────────────────────────────────────────────────────────────────

function FieldTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex items-center leading-none">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center text-gray-400 hover:text-gray-600 transition-colors ml-1"
        aria-label="Field information"
      >
        <Info size={12} />
      </button>
      {open && (
        <div className="absolute z-50 bottom-full left-0 mb-1.5 w-72 max-w-xs bg-[#001E2B] text-white text-xs rounded-lg shadow-xl p-3 leading-relaxed whitespace-normal">
          {text}
        </div>
      )}
    </span>
  );
}

function FieldLabel({ children, tip }: { children: React.ReactNode; tip: string }) {
  return (
    <div className="flex items-center gap-0 mb-1">
      <span className="text-xs font-medium text-gray-700 leading-none">{children}</span>
      <FieldTip text={tip} />
    </div>
  );
}

// ── Tab descriptions ──────────────────────────────────────────────────────────

const TAB_INFO: Record<'registered' | 'new', string> = {
  registered: 'Transfer to an account already saved in your profile: your own payout accounts or a saved contact. No need to enter account details; just select the source, the destination and the amount.',
  new: 'Transfer to a bank account not yet saved in your profile. You need to enter the IBAN and other banking details manually. You can optionally save the account for future use.',
};

type Tab = 'registered' | 'new';

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
          Access denied. This page is available to customers only.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Transfer', href: '/system/transfer' }, { label: 'Bank transfer' }]} />
      <SectionHeader icon={Landmark} title="Bank transfer" description="Send funds to a registered account or enter new bank details" />

      {token && partyRef && (
        <BankForm partyRef={partyRef} token={token} onDone={() => router.push('/system/transfer')} />
      )}
    </div>
  );
}

function BankForm({ partyRef, token, onDone }: { partyRef: string; token: string; onDone: () => void }) {
  const [tab, setTab] = useState<Tab>('registered');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(['registered', 'new'] as Tab[]).map(t => (
          <div key={t} className="flex items-center">
            <button
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                tab === t ? 'bg-[#001E2B] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'registered' ? 'Registered account' : 'New bank account'}
            </button>
            <FieldTip text={TAB_INFO[t]} />
          </div>
        ))}
      </div>

      {tab === 'registered'
        ? <RegisteredAccountForm partyRef={partyRef} token={token} onDone={onDone} />
        : <NewIbanForm onDone={onDone} />
      }
    </div>
  );
}

// ── Registered account transfer ───────────────────────────────────────────────

type DestinationType = 'own' | 'contact';

interface ContactOption {
  ref: string;
  label: string;
  hint: string;
}

function RegisteredAccountForm({ partyRef, token, onDone }: { partyRef: string; token: string; onDone: () => void }) {
  const [accounts, setAccounts] = useState<PayoutAccountOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [fromRef, setFromRef] = useState('');
  const [destType, setDestType] = useState<DestinationType>('own');
  const [toAccountRef, setToAccountRef] = useState('');
  const [toContactRef, setToContactRef] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ label: string; amount: number; currency: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api.accounts.list(partyRef, token, { status: 'active' }),
      api.beneficiaries.list(token, { ownerRef: partyRef }),
    ]).then(([accRes, benRes]) => {
      const accts = accRes.results as unknown as PayoutAccountOption[];
      const bens = ((benRes.results ?? []) as unknown as Beneficiary[])
        .filter(b => b.counterpartyArrangementStatus !== 'removed')
        .map(b => ({ ref: b.counterpartyArrangementReference, label: b.counterpartyLabel, hint: b.counterpartyLookupHint }));

      setAccounts(accts);
      setContacts(bens);
      setLoaded(true);

      if (accts.length > 0) setFromRef(accts[0].payoutAccountInstanceReference);
      if (accts.length > 1) setToAccountRef(accts[1].payoutAccountInstanceReference);
      else if (accts.length === 1) setDestType('contact');
      if (bens.length > 0) setToContactRef(bens[0].ref);
    }).catch(() => setLoaded(true));
  }, [partyRef, token]);

  const fromAccount = accounts.find(a => a.payoutAccountInstanceReference === fromRef);
  const toAccountOptions = accounts.filter(a => a.payoutAccountInstanceReference !== fromRef);

  function handleFromChange(ref: string) {
    setFromRef(ref);
    if (toAccountRef === ref) {
      const other = accounts.find(a => a.payoutAccountInstanceReference !== ref);
      setToAccountRef(other?.payoutAccountInstanceReference ?? '');
    }
  }

  async function handleTransfer() {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) { setError('Enter a valid amount.'); return; }
    if (!fromRef) { setError('Select a source account.'); return; }

    if (destType === 'own') {
      if (!toAccountRef) { setError('Select a destination account.'); return; }
      setError('Account-to-account transfers are not yet available. Please use "Send to contact" to transfer via a saved contact.');
      return;
    }

    if (!toContactRef) { setError('Select a contact.'); return; }
    setError('');
    try {
      const res = await api.beneficiaries.transfer(
        partyRef, toContactRef,
        { fromAccountRef: fromRef, amount: parsed, note: note.trim() || undefined },
        token,
      );
      const contact = contacts.find(c => c.ref === toContactRef);
      setSuccess({ label: contact?.label ?? 'contact', amount: parsed, currency: res.currency });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed.');
    }
  }

  if (success) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="text-center py-4">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Check size={24} className="text-green-600" />
          </div>
          <p className="font-semibold text-gray-900">{fmtAmount(success.amount, success.currency)} sent</p>
          <p className="text-xs text-gray-500 mt-1">To: {success.label}</p>
        </div>
        <button type="button" onClick={onDone}
          className="w-full py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg hover:bg-[#001E2B]/80 transition-colors">
          Done
        </button>
      </div>
    );
  }

  if (!loaded) {
    return <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      {/* Source account */}
      <div>
        <FieldLabel tip="The account the funds will be debited from. All your active registered payout accounts are shown, regardless of which bank holds them.">
          From account
        </FieldLabel>
        {accounts.length === 0 ? (
          <p className="text-xs text-amber-600">No active accounts found. <Link href="/system/accounts" className="underline">Manage your accounts.</Link></p>
        ) : (
          <>
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
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-gray-300">
        <div className="flex-1 border-t border-gray-100" />
        <ArrowRight size={14} className="text-gray-400 shrink-0" />
        <div className="flex-1 border-t border-gray-100" />
      </div>

      {/* Destination type toggle */}
      <div>
        <FieldLabel tip="Choose whether to send to one of your own registered accounts or to a saved contact. Both are bank accounts already in the system; no account details need to be re-entered.">
          To
        </FieldLabel>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium mb-3 w-fit">
          {(['own', 'contact'] as DestinationType[]).map(dt => (
            <button key={dt} type="button" onClick={() => setDestType(dt)}
              className={`px-3 py-1.5 transition-colors ${destType === dt ? 'bg-[#001E2B] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {dt === 'own' ? 'My accounts' : 'Saved contacts'}
            </button>
          ))}
        </div>

        {destType === 'own' ? (
          toAccountOptions.length === 0 ? (
            <p className="text-xs text-amber-600">You need at least two accounts to transfer between them. <Link href="/system/accounts" className="underline">Manage your accounts.</Link></p>
          ) : (
            <select value={toAccountRef} onChange={e => setToAccountRef(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
              {toAccountOptions.map(a => (
                <option key={a.payoutAccountInstanceReference} value={a.payoutAccountInstanceReference}>
                  {a.payoutAccountIsDefault ? '★ ' : ''}{a.payoutAccountAlias || a.payoutAccountBankName || 'Account'} · {a.payoutAccountCurrency}
                </option>
              ))}
            </select>
          )
        ) : (
          contacts.length === 0 ? (
            <p className="text-xs text-amber-600">No saved contacts. <Link href="/system/beneficiaries" className="underline">Add a contact first.</Link></p>
          ) : (
            <select value={toContactRef} onChange={e => setToContactRef(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40">
              {contacts.map(c => (
                <option key={c.ref} value={c.ref}>{c.label} · {c.hint}</option>
              ))}
            </select>
          )
        )}
      </div>

      {/* Amount */}
      <div>
        <FieldLabel tip="Amount to send in the source account's currency. For transfers to contacts, if the recipient's account is in a different currency, an FX conversion is applied automatically at the prevailing rate.">
          Amount
        </FieldLabel>
        <div className="flex gap-2">
          <input value={amount} onChange={e => setAmount(e.target.value)}
            type="number" min="0.01" step="0.01" placeholder="0.00"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          <span className="flex items-center px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-600">
            {fromAccount?.payoutAccountCurrency ?? 'N/A'}
          </span>
        </div>
      </div>

      {/* Note */}
      <div>
        <FieldLabel tip="Optional free-text memo attached to the transfer. Visible in transaction history. Max 140 characters.">
          Note <span className="text-gray-400 font-normal">(optional)</span>
        </FieldLabel>
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={140}
          placeholder="e.g. Rent, invoice payment…"
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
          Send
        </button>
      </div>
    </div>
  );
}

// ── New bank account (IBAN entry) ─────────────────────────────────────────────

interface IbanFormState {
  iban: string; bic: string; holderName: string; bankName: string;
  amount: string; currency: string; reference: string; save: boolean;
}

function NewIbanForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState<IbanFormState>({
    iban: '', bic: '', holderName: '', bankName: '',
    amount: '', currency: 'EUR', reference: '', save: false,
  });

  function set(field: keyof IbanFormState, value: string | boolean) {
    setForm(f => ({ ...f, [field]: value }));
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700 space-y-1">
        <p className="font-medium">Wire transfer: coming soon</p>
        <p className="text-xs">Transfers to unregistered accounts require a live payment rail integration (SEPA / SWIFT). You can fill in the details and save the account for when this feature becomes available.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <FieldLabel tip="International Bank Account Number (ISO 13616). Identifies the recipient's bank account globally. Format: 2-letter country code, 2 check digits, then up to 30 alphanumeric characters. Example: DE89370400440532013000. Spaces are ignored.">
            IBAN
          </FieldLabel>
          <input value={form.iban} onChange={e => set('iban', e.target.value.toUpperCase().replace(/\s/g, ''))}
            placeholder="e.g. DE89370400440532013000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>

        <div>
          <FieldLabel tip="Bank Identifier Code (ISO 9362), also called SWIFT code. Identifies the recipient's bank on the SWIFT network. 8 characters identify the bank and country; an optional 3-character branch suffix makes it 11. Required for international wires; optional for domestic SEPA transfers where the IBAN is sufficient.">
            BIC / SWIFT
          </FieldLabel>
          <input value={form.bic} onChange={e => set('bic', e.target.value.toUpperCase())}
            placeholder="e.g. DEUTDEDB"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>

        <div>
          <FieldLabel tip="Legal name of the account holder exactly as registered with their bank. Must match for beneficiary name checks (Confirmation of Payee / SEPA validation).">
            Account holder name
          </FieldLabel>
          <input value={form.holderName} onChange={e => set('holderName', e.target.value)}
            placeholder="Full legal name"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>

        <div>
          <FieldLabel tip="Name of the recipient's bank. Optional, as the IBAN and BIC are sufficient to route the payment. Providing it improves readability in your transfer history and may be required by some correspondent banks for manual processing.">
            Bank name <span className="text-gray-400 font-normal">(optional)</span>
          </FieldLabel>
          <input value={form.bankName} onChange={e => set('bankName', e.target.value)}
            placeholder="e.g. Deutsche Bank"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>

        <div>
          <FieldLabel tip="Amount to send. Choose the currency to match the destination account or your preferred settlement currency. An FX conversion may apply depending on your source account.">
            Amount
          </FieldLabel>
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
          <FieldLabel tip="Free-text reference included in the payment message (ISO 20022 RemittanceInformation). The recipient sees this on their bank statement. Examples: invoice number, order ID, reason for payment. Max 140 characters; some networks truncate to 35.">
            Payment reference <span className="text-gray-400 font-normal">(optional)</span>
          </FieldLabel>
          <input value={form.reference} onChange={e => set('reference', e.target.value)} maxLength={140}
            placeholder="e.g. Invoice 1234"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={form.save} onChange={e => set('save', e.target.checked)}
          className="rounded border-gray-300 text-[#00ED64] focus:ring-[#00ED64]/40" />
        <span className="text-xs text-gray-600">Save this account for future transfers</span>
        <FieldTip text="If checked, the IBAN and BIC are stored as a new registered account in your profile. The IBAN is encrypted at rest. You can select it next time without re-entering the details." />
      </label>

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

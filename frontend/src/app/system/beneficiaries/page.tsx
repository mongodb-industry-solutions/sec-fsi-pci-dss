'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  UserCheck, Search, Plus, Mail, Phone, Trash2, ChevronLeft, ChevronRight, X, SendHorizonal, Check, Landmark,
} from 'lucide-react';
import { SectionHeader } from '../../../components/SectionHeader';
import { useDebugMode } from '../../../lib/debugMode';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';

interface Beneficiary {
  counterpartyArrangementReference: string;
  ownerPartyReference: string;
  counterpartyPartyReference: string;
  counterpartyLabel: string;
  counterpartyLookupType: 'phone' | 'email';
  counterpartyLookupHint: string;
  counterpartyArrangementStatus: 'active' | 'removed';
  recordCreatedDateTime: string;
}

interface PayoutAccountOption {
  payoutAccountInstanceReference: string;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
  payoutAccountCurrency: string;
  payoutAccountIsDefault: boolean;
  payoutAccountBalance?: { availableAmount: number };
}

function fmtAmount(n: number, currency: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(n);
}

// ── Send Money Modal ──────────────────────────────────────────────────────────
interface SendMoneyModalProps {
  beneficiary: Pick<Beneficiary, 'counterpartyArrangementReference' | 'counterpartyLabel'>;
  ownerPartyRef: string;
  token: string;
  onClose: () => void;
}

function SendMoneyModal({ beneficiary, ownerPartyRef, token, onClose }: SendMoneyModalProps) {
  const [accounts, setAccounts] = useState<PayoutAccountOption[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [fromAccountRef, setFromAccountRef] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ ref: string; amount: number; currency: string } | null>(null);

  useEffect(() => {
    if (!ownerPartyRef || !token) return;
    api.accounts.list(ownerPartyRef, token, { status: 'active' })
      .then(r => {
        const accts = r.results as unknown as PayoutAccountOption[];
        setAccounts(accts);
        setAccountsLoaded(true);
        const primary = accts.find(a => a.payoutAccountIsDefault) ?? accts[0];
        if (primary) setFromAccountRef(primary.payoutAccountInstanceReference);
      })
      .catch(() => setAccountsLoaded(true));
  }, [ownerPartyRef, token]);

  async function handleSend() {
    const parsedAmount = parseFloat(amount);
    if (!fromAccountRef || isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Select an account and enter a valid amount.'); return;
    }
    setSending(true); setError('');
    try {
      const res = await api.beneficiaries.transfer(
        ownerPartyRef,
        beneficiary.counterpartyArrangementReference,
        { fromAccountRef, amount: parsedAmount, note: note.trim() || undefined },
        token,
      );
      setSuccess({ ref: res.transferReference, amount: parsedAmount, currency: res.currency });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed.');
    }
    setSending(false);
  }

  const selectedAccount = accounts.find(a => a.payoutAccountInstanceReference === fromAccountRef);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <SendHorizonal size={18} className="text-[#001E2B]" />
            <div>
              <h3 className="font-semibold text-gray-900">Send money</h3>
              <p className="text-xs text-gray-500">to <span className="font-medium text-gray-700">{beneficiary.counterpartyLabel}</span></p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check size={24} className="text-green-600" />
              </div>
              <p className="font-semibold text-gray-900">{fmtAmount(success.amount, success.currency)} sent</p>
              <p className="text-sm text-gray-500 mt-1">to {beneficiary.counterpartyLabel}</p>
              <p className="text-xs font-mono text-gray-400 mt-2">Ref: {success.ref.slice(0, 8)}…</p>
            </div>
            <button type="button" onClick={onClose}
              className="w-full py-2 text-sm font-medium bg-[#001E2B] text-white rounded-lg hover:bg-[#001E2B]/80 transition-colors">
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">From account</label>
                {!accountsLoaded ? (
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
                  placeholder="e.g. Dinner split, rent contribution…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              </div>
            </div>
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <p className="text-xs text-gray-400">
              Funds transfer immediately (BIAN SD-65 Payment Execution). Recipient's default payout account is credited.
            </p>
            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleSend} disabled={sending || accounts.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#001E2B] hover:bg-[#001E2B]/80 text-white rounded-lg transition-colors disabled:opacity-50">
                <SendHorizonal size={14} />
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function shortRef(ref: string) {
  return ref.length > 12 ? ref.slice(0, 8) + '…' : ref;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Add / lookup modal ────────────────────────────────────────────────────────
interface AddModalProps {
  ownerRef: string;       // pre-filled for customers, editable for staff
  lockOwner: boolean;     // true for customer (cannot change ownerRef)
  token: string;
  onClose: () => void;
  onAdded: () => void;
}

function AddBeneficiaryModal({ ownerRef: initialOwner, lockOwner, token, onClose, onAdded }: AddModalProps) {
  const [ownerRef, setOwnerRef] = useState(initialOwner);
  const [lookupType, setLookupType] = useState<'phone' | 'email'>('email');
  const [lookupValue, setLookupValue] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ label: string; hint: string } | null>(null);
  const [notFound, setNotFound] = useState(false);

  async function handleAdd() {
    if (!ownerRef.trim() || !lookupValue.trim()) {
      setError('All required fields must be filled.');
      return;
    }
    setLoading(true); setError(''); setNotFound(false); setDone(null);
    try {
      const res = await api.beneficiaries.add(
        ownerRef.trim(),
        { lookupType, lookupValue: lookupValue.trim(), label: label.trim() || undefined },
        token,
      );
      if (!res.found) { setNotFound(true); }
      else { setDone({ label: res.counterpartyLabel ?? label, hint: res.counterpartyLookupHint ?? '' }); onAdded(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add.');
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <UserCheck size={18} className="text-[#001E2B]" />
            <h3 className="font-semibold text-gray-900">Add beneficiary</h3>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-xs text-gray-500">
          Enter the phone or email of the person you want to add. Their contact is resolved via secure search — it is never stored in plain text (BIAN SD-54 · PCI DSS Req 3.4).
        </p>

        <div className="space-y-3">
          {!lockOwner && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Owner party reference <span className="text-red-500">*</span></label>
              <input value={ownerRef} onChange={e => setOwnerRef(e.target.value)}
                placeholder="b0000001-0000-4000-8000-000000000001"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Lookup type</label>
            <div className="flex gap-2">
              {(['email', 'phone'] as const).map(t => (
                <button key={t} type="button" onClick={() => setLookupType(t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    lookupType === t ? 'bg-[#001E2B] text-[#00ED64] border-[#001E2B]' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                  }`}>
                  {t === 'email' ? <Mail size={13} /> : <Phone size={13} />}
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {lookupType === 'email' ? 'Email address' : 'Phone number'} <span className="text-red-500">*</span>
            </label>
            <input value={lookupValue} onChange={e => setLookupValue(e.target.value)}
              placeholder={lookupType === 'email' ? 'contact@example.com' : '+34612345678'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Alias <span className="text-gray-400">(optional)</span></label>
            <input value={label} onChange={e => setLabel(e.target.value)} maxLength={80}
              placeholder="e.g. Mom, Flatmate, Business Partner"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
        </div>

        {notFound && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Contact not found or already registered. No entry was created.
          </div>
        )}
        {done && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            Beneficiary added — <strong>{done.label}</strong> ({done.hint})
          </div>
        )}
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && (
            <button type="button" onClick={handleAdd} disabled={loading}
              className="px-4 py-2 text-sm font-medium bg-[#001E2B] hover:bg-[#001E2B]/80 text-white rounded-lg transition-colors disabled:opacity-50">
              {loading ? 'Looking up…' : 'Add contact'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BeneficiariesPage() {
  const router = useRouter();
  const { debugMode } = useDebugMode();

  const [token, setToken] = useState('');
  const [role, setRole] = useState('');
  const [ownPartyRef, setOwnPartyRef] = useState('');
  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    if (t) {
      const u = decodeToken(t);
      setRole(u?.role ?? '');
      setOwnPartyRef(u?.partyRef ?? '');
    }
  }, []);

  const isCustomer = role === 'customer';
  const isStaff = role === 'level1_analyst' || role === 'level2_investigator' || role === 'security_auditor';
  const canWrite = role === 'customer' || role === 'level2_investigator' || role === 'security_auditor';

  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [sendTarget, setSendTarget] = useState<Beneficiary | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Beneficiary | null>(null);
  const [removing, setRemoving] = useState(false);

  const LIMIT = 10;

  const load = useCallback(async (pg: number, q: string, owner: string) => {
    if (!token) return;
    setLoading(true); setError('');
    try {
      // Customers: always scoped to own — pass ownerRef so backend returns own records only
      const effectiveOwner = isCustomer ? ownPartyRef : owner;
      const res = await api.beneficiaries.list(token, {
        page: pg, limit: LIMIT,
        ...(q ? { q } : {}),
        ...(effectiveOwner ? { ownerRef: effectiveOwner } : {}),
      });
      setBeneficiaries(res.results);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    }
    setLoading(false);
  }, [token, isCustomer, ownPartyRef]);

  useEffect(() => {
    if (token && (isCustomer ? ownPartyRef : true)) load(page, search, ownerFilter);
  }, [token, page, load, search, ownerFilter, isCustomer, ownPartyRef]);

  function handleSearchChange(val: string) {
    setSearch(val);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(1, val, ownerFilter), 350);
  }

  async function handleRemove(b: Beneficiary) {
    setRemoving(true);
    try {
      await api.beneficiaries.remove(b.ownerPartyReference, b.counterpartyArrangementReference, token);
      setConfirmRemove(null);
      load(page, search, ownerFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove.');
    }
    setRemoving(false);
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const description = isCustomer
    ? 'Saved contacts for fast transfers. Click a contact to send money or manage your list.'
    : 'Saved counterparty contacts registered by customers for transfers and payments.';

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <SectionHeader
        icon={UserCheck}
        title="Beneficiaries"
        description={description}
        info={isCustomer
          ? 'Your beneficiaries are looked up by phone or email when registered, the raw contact is never stored, only a secure reference (BIAN SD-54 Counterparty Administration).'
          : 'Contact hints are masked at registration time. Raw phone/email is resolved via QE equality search and never persisted. BIAN SD-54 Counterparty Administration.'
        }
        debugInfo="BIAN SD-54 Counterparty Administration · PCI DSS Req 3.4 · Req 7 (scope: own for customers)"
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search by name or contact…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>
        {/* Staff-only: owner filter */}
        {isStaff && (
          <input value={ownerFilter} onChange={e => { setOwnerFilter(e.target.value); setPage(1); load(1, search, e.target.value); }}
            placeholder="Filter by owner party ref…"
            className="w-60 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        )}
        {canWrite && (
          <button type="button" onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={14} /> Add contact
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600">{error}</div>
        ) : beneficiaries.length === 0 ? (
          <div className="p-8 text-center">
            <UserCheck size={32} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm text-gray-500">
              {search ? 'No matching contacts.' : isCustomer ? 'You have no saved contacts yet. Add someone to send money quickly.' : 'No beneficiaries found.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Identifier</th>
                  {isStaff && <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Owner</th>}
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Added</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {beneficiaries.map((b) => (
                  <tr key={b.counterpartyArrangementReference}
                    onClick={() => router.push(`/system/beneficiaries/${b.counterpartyArrangementReference}`)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{b.counterpartyLabel}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-gray-600">
                        {b.counterpartyLookupType === 'email'
                          ? <Mail size={12} className="text-blue-400 shrink-0" />
                          : <Phone size={12} className="text-green-400 shrink-0" />}
                        <span className="font-mono text-xs">{b.counterpartyLookupHint}</span>
                      </span>
                    </td>
                    {isStaff && (
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-gray-400" title={b.ownerPartyReference}>{shortRef(b.ownerPartyReference)}</span>
                      </td>
                    )}
                    <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(b.recordCreatedDateTime)}</td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {isCustomer && b.counterpartyArrangementStatus === 'active' && (
                          <button type="button"
                            onClick={() => setSendTarget(b)}
                            className="flex items-center gap-1 text-xs text-[#001E2B] hover:text-[#001E2B]/70 border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-1 transition-colors"
                            title="Send money">
                            <SendHorizonal size={12} /> Send
                          </button>
                        )}
                        {canWrite && b.counterpartyArrangementStatus === 'active' && (
                          <button type="button" onClick={() => setConfirmRemove(b)}
                            className="text-gray-400 hover:text-red-500 transition-colors p-1" title="Remove">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{total} total · page {page} of {totalPages}</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors">
              <ChevronLeft size={14} />
            </button>
            <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {debugMode && (
        <p className="text-[10px] font-mono text-gray-400">
          GET /api/v1/beneficiaries · SD-54 · roleScope: {isCustomer ? 'own' : 'all'} · ownerRef: {isCustomer ? ownPartyRef : ownerFilter || '(all)'}
        </p>
      )}

      {sendTarget && (
        <SendMoneyModal
          beneficiary={sendTarget}
          ownerPartyRef={ownPartyRef}
          token={token}
          onClose={() => setSendTarget(null)}
        />
      )}

      {showAddModal && (
        <AddBeneficiaryModal
          ownerRef={ownPartyRef}
          lockOwner={isCustomer}
          token={token}
          onClose={() => setShowAddModal(false)}
          onAdded={() => { setShowAddModal(false); load(page, search, ownerFilter); }}
        />
      )}

      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">Remove contact?</h3>
            <p className="text-sm text-gray-600">
              This will remove <strong>{confirmRemove.counterpartyLabel}</strong> from your contacts.
              The record is retained for audit purposes (PCI DSS Req 10).
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmRemove(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button type="button" onClick={() => handleRemove(confirmRemove)} disabled={removing}
                className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-60">
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

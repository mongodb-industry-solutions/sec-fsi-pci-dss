'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  UserCheck, Search, Plus, Mail, Phone, Trash2, ChevronLeft, ChevronRight, X, SendHorizonal, Check, Landmark, HandCoins, Download,
} from 'lucide-react';
import { SectionHeader } from '../../../components/SectionHeader';
import { RequestMoneyModal } from '../../../components/RequestMoneyModal';
import { useDebugMode } from '../../../lib/debugMode';
import { Combobox } from '../../../components/ui/Combobox';
import { AuditTrailLink } from '../../../components/AuditTrailLink';
import { downloadJsonFile, appliedFilters } from '../../../lib/downloadJson';
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
              The transfer is processed immediately. Funds are credited to the recipient's default account.
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
          Enter the phone or email of the person you want to add. We look them up securely, their raw contact details are never stored.
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
            Beneficiary added: <strong>{done.label}</strong> ({done.hint})
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
  // The auditor is read-only on beneficiaries; the server returns 403 regardless.
  const canWrite = role === 'customer' || role === 'level2_investigator';
  // Cross-party search needs beneficiaries:investigate; L1 drills down by owner instead.
  const canSearchAcrossParties = role === 'level2_investigator' || role === 'security_auditor';

  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [caseFilter, setCaseFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'removed'>('active');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [sendTarget, setSendTarget] = useState<Beneficiary | null>(null);
  const [requestTarget, setRequestTarget] = useState<Beneficiary | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Beneficiary | null>(null);
  const [removing, setRemoving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const LIMIT = 10;

  // A staff caller needs a predicate (owner party reference, or MIN_QUERY chars) before any
  // request is issued. The server enforces the same rule and returns 400 without one.
  const MIN_QUERY = 3;
  const hasPredicate = isCustomer || !!ownerFilter.trim() || !!caseFilter.trim() || search.trim().length >= MIN_QUERY;

  const load = useCallback(async (pg: number, q: string, owner: string, caseRef = '', status: 'active' | 'removed' = 'active') => {
    if (!token) return;
    // Customers: always scoped to own; the backend forces it regardless of what is sent.
    const effectiveOwner = isCustomer ? ownPartyRef : owner.trim();
    const term = q.trim();
    const kase = caseRef.trim();
    if (!isCustomer && !effectiveOwner && !kase && term.length < MIN_QUERY) {
      setBeneficiaries([]); setTotal(0); setError(''); setLoading(false);
      return;
    }
    setLoading(true); setError('');
    try {
      const res = await api.beneficiaries.list(token, {
        page: pg, limit: LIMIT,
        ...(term ? { q: term } : {}),
        ...(effectiveOwner ? { ownerRef: effectiveOwner } : {}),
        ...(kase ? { caseRef: kase } : {}),
        ...(isCustomer ? {} : { status }),
      });
      setBeneficiaries(res.results);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    }
    setLoading(false);
  }, [token, isCustomer, ownPartyRef]);

  useEffect(() => {
    // Customers load their own list; staff wait for a predicate (no query on mount).
    if (!token) return;
    if (isCustomer) { if (ownPartyRef) load(page, search, ownerFilter); return; }
    if (hasPredicate) load(page, search, ownerFilter, caseFilter, statusFilter);
    else { setBeneficiaries([]); setTotal(0); }
  }, [token, page, load, search, ownerFilter, caseFilter, statusFilter, isCustomer, ownPartyRef, hasPredicate]);

  // Evidence extract of the scoped result set: the whole predicate, the totals and every record
  // an oversight role just read, so a finding can be filed without a screenshot.
  const exportEvidence = useCallback(async () => {
    if (!token || !hasPredicate) return;
    setExporting(true);
    try {
      const filters = {
        ownerRef: ownerFilter.trim(), caseRef: caseFilter.trim(),
        q: search.trim(), status: statusFilter,
      };
      const PER = 100;
      const collected: Beneficiary[] = [];
      let pageN = 1;
      let grandTotal = 0;
      for (;;) {
        const res = await api.beneficiaries.list(token, { ...appliedFilters(filters), page: pageN, limit: PER });
        grandTotal = res.total;
        collected.push(...res.results);
        if (collected.length >= res.total || res.results.length < PER) break;
        pageN += 1;
      }
      downloadJsonFile('beneficiaries', {
        generatedAt: new Date().toISOString(),
        generatedByRole: role,
        bianServiceDomain: 'SD-54 Counterparty Administration',
        note: 'Contact details are stored masked (PCI DSS Req 3.4). Each read is recorded in the compliance ledger.',
        filtersApplied: appliedFilters(filters),
        totalMatching: grandTotal,
        exported: collected.length,
        records: collected,
      });
    } catch { /* non-blocking: the empty download signals the failure */ }
    setExporting(false);
  }, [token, hasPredicate, ownerFilter, caseFilter, search, statusFilter, role]);

  function handleSearchChange(val: string) {
    setSearch(val);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(1, val, ownerFilter, caseFilter, statusFilter), 350);
  }

  async function handleRemove(b: Beneficiary) {
    setRemoving(true);
    try {
      await api.beneficiaries.remove(b.ownerPartyReference, b.counterpartyArrangementReference, token);
      setConfirmRemove(null);
      load(page, search, ownerFilter, caseFilter, statusFilter);
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
          ? 'Your saved contacts for quick transfers. Add someone by phone or email, we never store their raw contact details, only a secure reference.'
          : 'Saved contacts registered by customers for transfers and payments. Contact details are masked at registration time.'
        }
        debugInfo="BIAN SD-54 Counterparty Administration · PCI DSS Req 3.4 · Req 7 (scope: own for customers)"
      />

      {/* Toolbar. Staff read one owner, one case, or a search term: the three alternative
          predicates the server accepts, labelled so it is clear any single one is enough. */}
      {isCustomer ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search by name or contact…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          {canWrite && (
            <button type="button" onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <Plus size={14} /> Add contact
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Alias or masked contact</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={e => handleSearchChange(e.target.value)}
                  placeholder={`e.g. Mom, Flatmate, ***@ (min ${MIN_QUERY} characters)`}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                Matches the alias and the masked hint only. A full email or phone number is never stored, so it will not match.
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Owner party reference</label>
              <input value={ownerFilter}
                onChange={e => { setOwnerFilter(e.target.value); setPage(1); load(1, search, e.target.value, caseFilter, statusFilter); }}
                placeholder="Party UUID of the customer"
                className="w-full px-3 py-2 text-sm font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              <p className="mt-1 text-[11px] text-gray-400">Copy it from the customer record (Users).</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Investigation case</label>
              <input value={caseFilter}
                onChange={e => { setCaseFilter(e.target.value); setPage(1); load(1, search, ownerFilter, e.target.value, statusFilter); }}
                placeholder="FD-2026-000123"
                className="w-full px-3 py-2 text-sm font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
              <p className="mt-1 text-[11px] text-gray-400">Resolves to the case customer.</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <Combobox
                editable={false}
                value={statusFilter}
                onChange={(v) => { setStatusFilter(v as 'active' | 'removed'); setPage(1); load(1, search, ownerFilter, caseFilter, v as 'active' | 'removed'); }}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'removed', label: 'Removed (deregistered)' },
                ]}
              />
            </div>
            <div className="flex items-end gap-2 lg:col-span-2">
              {hasPredicate && (
                <button type="button"
                  onClick={() => { setSearch(''); setOwnerFilter(''); setCaseFilter(''); setStatusFilter('active'); setPage(1); }}
                  className="text-xs px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                  Clear
                </button>
              )}
              {hasPredicate && (
                <button type="button" onClick={exportEvidence} disabled={exporting || loading}
                  title="Download the records matching these filters as a JSON extract"
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors disabled:opacity-50">
                  <Download size={13} /> {exporting ? 'Preparing…' : 'Export evidence'}
                </button>
              )}
              {(ownerFilter.trim() || caseFilter.trim()) && (
                <AuditTrailLink
                  reference={(ownerFilter || caseFilter).trim()}
                  label="Audit trail for this predicate"
                  className="py-2"
                />
              )}
              {canWrite && (
                <button type="button" onClick={() => setShowAddModal(true)}
                  className="ml-auto flex items-center gap-1.5 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  <Plus size={14} /> Add contact
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty search state for staff until a predicate is supplied. */}
      {!isCustomer && !hasPredicate && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-600 space-y-1">
          <p className="font-medium text-gray-800">Search for a beneficiary to begin</p>
          <p>
            Any single predicate is enough: an owner party reference, an investigation case, or at
            least {MIN_QUERY} characters of an alias or masked contact. Listing the whole registry is
            not offered to any role (ADR-048).
            {canSearchAcrossParties
              ? ' A cross-party search is available to your role and every record it returns is recorded in the compliance ledger.'
              : ' Your role can look up beneficiaries for a known owner party; cross-party search requires the investigate capability.'}
          </p>
        </div>
      )}

      {/* What this view is scoped to, for the record an auditor is building. */}
      {!isCustomer && hasPredicate && !loading && !error && (
        <p className="text-xs text-gray-500">
          {total} {total === 1 ? 'record' : 'records'} · status {statusFilter}
          {ownerFilter.trim() && <> · owner <span className="font-mono">{shortRef(ownerFilter.trim())}</span></>}
          {caseFilter.trim() && <> · case <span className="font-mono">{caseFilter.trim()}</span></>}
          {search.trim() && <> · matching &ldquo;{search.trim()}&rdquo;</>}
          . Contact details are masked at registration (PCI DSS Req 3.4) and this read is recorded in
          the compliance ledger.
        </p>
      )}

      {/* Table */}
      {(isCustomer || hasPredicate) && (
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
                  {isStaff && <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>}
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
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <button type="button"
                          onClick={() => { setOwnerFilter(b.ownerPartyReference); setSearch(''); setCaseFilter(''); setPage(1); }}
                          title={`Scope to owner ${b.ownerPartyReference}`}
                          className="font-mono text-xs text-gray-500 underline decoration-dotted hover:text-[#001E2B]">
                          {shortRef(b.ownerPartyReference)}
                        </button>
                      </td>
                    )}
                    {isStaff && (
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded border ${
                          b.counterpartyArrangementStatus === 'active'
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-gray-100 text-gray-600 border-gray-200'
                        }`}>
                          {b.counterpartyArrangementStatus}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(b.recordCreatedDateTime)}</td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {isStaff && (
                          <AuditTrailLink
                            reference={b.counterpartyArrangementReference}
                            label="Audit"
                            className="px-2.5 py-1"
                          />
                        )}
                        {isCustomer && b.counterpartyArrangementStatus === 'active' && (
                          <button type="button"
                            onClick={() => setSendTarget(b)}
                            className="flex items-center gap-1 text-xs text-[#001E2B] hover:text-[#001E2B]/70 border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-1 transition-colors"
                            title="Send money">
                            <SendHorizonal size={12} /> Send
                          </button>
                        )}
                        {isCustomer && b.counterpartyArrangementStatus === 'active' && (
                          <button type="button"
                            onClick={() => setRequestTarget(b)}
                            className="flex items-center gap-1 text-xs text-[#001E2B] hover:text-[#001E2B]/70 border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-1 transition-colors"
                            title="Request money">
                            <HandCoins size={12} /> Request
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
      )}

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
          GET /api/v1/beneficiaries · SD-54 · scope: {isCustomer ? 'own (forced server-side)' : 'search'} · predicate: {isCustomer ? `ownerRef=${ownPartyRef}` : ownerFilter.trim() ? `ownerRef=${ownerFilter.trim()}` : search.trim().length >= MIN_QUERY ? `q=${search.trim()}` : 'none (no request issued)'}
        </p>
      )}

      {requestTarget && (
        <RequestMoneyModal
          beneficiary={requestTarget}
          token={token}
          onClose={() => setRequestTarget(null)}
        />
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
              The record is retained for your transaction history.
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

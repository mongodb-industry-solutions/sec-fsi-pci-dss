'use client';
// BIAN SD-66: Payout Account — Account List Page (v17 Phase C)
// PCI DSS Req 3.3: IBAN never shown in full. PCI DSS Req 7: partyRef from JWT enforced server-side.

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Landmark, Filter, Search, X, Plus, CheckCircle2, XCircle, Clock, Star } from 'lucide-react';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { SectionHeader } from '../../../components/SectionHeader';
import { Breadcrumb, type Crumb } from '../../../components/Breadcrumb';
import { Pagination } from '../../../components/Pagination';
import { RequirePermission } from '../../../components/RequirePermission';
import { useNotify } from '../../../components/ui/ConfirmProvider';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PayoutAccount {
  payoutAccountInstanceReference: string;
  partyInstanceReference: string;
  payoutAccountType: string;
  payoutAccountStatus: string;
  payoutAccountCurrency: string;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
  payoutAccountIsDefault: boolean;
  payoutAccountPreferredRail: string;
  payoutAccountCountryCode?: string;
  recordCreatedDateTime: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { icon: typeof CheckCircle2; cls: string }> = {
  active:    { icon: CheckCircle2, cls: 'bg-green-50 text-green-700 border-green-200' },
  suspended: { icon: Clock,        cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  closed:    { icon: XCircle,      cls: 'bg-gray-100 text-gray-500 border-gray-200' },
};

const TYPE_LABELS: Record<string, string> = {
  bank_account:    'Bank Account',
  wallet:          'Wallet',
  internal_ledger: 'PSP Ledger',
};

const RAIL_LABELS: Record<string, string> = {
  sepa:            'SEPA',
  ach:             'ACH',
  local_bank:      'Local Bank',
  internal_wallet: 'Internal Wallet',
  internal_ledger: 'Internal Ledger',
};

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'closed', label: 'Closed' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'bank_account', label: 'Bank Account' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'internal_ledger', label: 'PSP Ledger' },
];

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'bank_account', label: 'Bank Account' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'internal_ledger', label: 'PSP Ledger' },
];

const RAIL_OPTIONS = [
  { value: 'sepa',            label: 'SEPA' },
  { value: 'ach',             label: 'ACH' },
  { value: 'local_bank',      label: 'Local Bank' },
  { value: 'internal_wallet', label: 'Internal Wallet' },
  { value: 'internal_ledger', label: 'Internal Ledger' },
];

const CURRENCY_OPTIONS = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'DKK', 'NOK', 'PLN'];

// ── Helper components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { icon: Clock, cls: 'bg-gray-100 text-gray-500 border-gray-200' };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      <Icon size={11} />
      {status}
    </span>
  );
}

function fmtDate(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Register Account Modal (C2) ───────────────────────────────────────────────

interface RegisterModalProps {
  partyRef: string;
  token: string;
  onClose: () => void;
  onCreated: () => void;
}

function RegisterAccountModal({ partyRef, token, onClose, onCreated }: RegisterModalProps) {
  const notify = useNotify();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    payoutAccountType: 'bank_account',
    payoutAccountAlias: '',
    payoutAccountBankName: '',
    payoutAccountCurrency: 'EUR',
    payoutAccountCountryCode: '',
    payoutAccountPreferredRail: 'sepa',
  });

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.payoutAccountCurrency) return;
    setSubmitting(true);
    try {
      await api.accounts.create(
        partyRef,
        {
          payoutAccountType: form.payoutAccountType,
          payoutAccountCurrency: form.payoutAccountCurrency,
          ...(form.payoutAccountAlias ? { payoutAccountAlias: form.payoutAccountAlias } : {}),
          ...(form.payoutAccountBankName ? { payoutAccountBankName: form.payoutAccountBankName } : {}),
          ...(form.payoutAccountCountryCode ? { payoutAccountCountryCode: form.payoutAccountCountryCode.toUpperCase() } : {}),
          ...(form.payoutAccountPreferredRail ? { payoutAccountPreferredRail: form.payoutAccountPreferredRail } : {}),
        },
        token,
      );
      notify('Account registered successfully.', 'success');
      onCreated();
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to register account.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#001E2B] flex items-center justify-center">
              <Landmark size={16} className="text-[#00ED64]" />
            </div>
            <h2 className="font-bold text-[#001E2B]">Register Payout Account</h2>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account type <span className="text-red-500">*</span></label>
            <select
              value={form.payoutAccountType}
              onChange={(e) => setField('payoutAccountType', e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            >
              {ACCOUNT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nickname / alias</label>
            <input
              type="text"
              value={form.payoutAccountAlias}
              onChange={(e) => setField('payoutAccountAlias', e.target.value)}
              placeholder="e.g. Main savings"
              maxLength={60}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bank name</label>
            <input
              type="text"
              value={form.payoutAccountBankName}
              onChange={(e) => setField('payoutAccountBankName', e.target.value)}
              placeholder="e.g. Deutsche Bank"
              maxLength={100}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency <span className="text-red-500">*</span></label>
              <select
                value={form.payoutAccountCurrency}
                onChange={(e) => setField('payoutAccountCurrency', e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country code</label>
              <input
                type="text"
                value={form.payoutAccountCountryCode}
                onChange={(e) => setField('payoutAccountCountryCode', e.target.value.slice(0, 2))}
                placeholder="DE"
                maxLength={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Preferred rail</label>
            <select
              value={form.payoutAccountPreferredRail}
              onChange={(e) => setField('payoutAccountPreferredRail', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            >
              {RAIL_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-[#001E2B] text-white rounded-lg py-2 text-sm font-medium hover:bg-[#001E2B]/80 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Registering…' : 'Register account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const router = useRouter();
  const notify = useNotify();

  const [token, setToken] = useState('');
  const [partyRef, setPartyRef] = useState('');

  // List state
  const [accounts, setAccounts] = useState<PayoutAccount[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  // Filter state (two-step search)
  const [nameInput, setNameInput] = useState('');   // what the user is typing
  const [search, setSearch] = useState('');          // applied on button click / Enter
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Modal state (C2)
  const [showRegister, setShowRegister] = useState(false);

  const load = useCallback(async (
    t: string, pRef: string,
    pg: number, lim: number, _name: string, status: string, _type: string,
  ) => {
    setLoading(true);
    try {
      const r = await api.accounts.list(pRef, t, {
        page: pg, limit: lim,
        ...(status ? { status } : {}),
      });
      setAccounts(r.results as unknown as PayoutAccount[]);
      setTotal(r.total);
    } catch {
      setAccounts([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = getToken() ?? '';
    const decoded = t ? decodeToken(t) : null;
    const pRef = decoded?.partyRef ?? '';
    if (!t || !pRef) { router.replace('/system'); return; }
    setToken(t);
    setPartyRef(pRef);
    load(t, pRef, 1, 10, '', '', '').finally(() => setReady(true));
  }, [router, load]);

  function applySearch() {
    const s = nameInput.trim();
    setSearch(s);
    setPage(1);
    load(token, partyRef, 1, limit, s, statusFilter, typeFilter);
  }

  function clearSearch() {
    setNameInput('');
    setSearch('');
    setPage(1);
    load(token, partyRef, 1, limit, '', statusFilter, typeFilter);
  }

  function handleStatusChange(v: string) {
    setStatusFilter(v);
    setPage(1);
    load(token, partyRef, 1, limit, search, v, typeFilter);
  }

  function handleTypeChange(v: string) {
    setTypeFilter(v);
    setPage(1);
    load(token, partyRef, 1, limit, search, statusFilter, v);
  }

  function handlePageChange(p: number) {
    setPage(p);
    load(token, partyRef, p, limit, search, statusFilter, typeFilter);
  }

  function handleLimitChange(lim: number) {
    setLimit(lim);
    setPage(1);
    load(token, partyRef, 1, lim, search, statusFilter, typeFilter);
  }

  function handleRefresh() {
    load(token, partyRef, page, limit, search, statusFilter, typeFilter);
  }

  const crumbs: Crumb[] = [
    { label: 'Home', href: '/system' },
    { label: 'Accounts' },
  ];

  const totalPages = Math.ceil(total / limit);
  const hasFilters = search || statusFilter || typeFilter;

  return (
    <RequirePermission resource="accounts" action="view">
      <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
        {ready && <Breadcrumb items={crumbs} />}

        <SectionHeader
          icon={Landmark}
          title="Payout Accounts"
          description="Manage your registered payout and settlement accounts (BIAN SD-66)."
          debugInfo="BIAN SD-66 Payout Account · PCI DSS Req 3.3 (IBAN encrypted QE) · Req 7 (partyRef JWT-scoped) · Req 10 (audited)"
        />

        {/* Register Account button (C2) */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowRegister(true)}
            className="inline-flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-[#00ED64] font-medium px-4 py-2 rounded-lg transition-colors text-sm"
          >
            <Plus size={15} />
            Register Account
          </button>
        </div>

        {/* Filter row (C1) */}
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <Filter size={13} />
            Filter accounts
          </div>

          {/* Search row */}
          <div className="flex gap-2 flex-wrap">
            <div className="flex flex-1 min-w-[200px] gap-0">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                placeholder="Search by alias or bank name…"
                className="flex-1 border border-gray-300 rounded-l-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 focus:border-[#00ED64]"
              />
              <button
                type="button"
                onClick={applySearch}
                className="border border-l-0 border-gray-300 bg-[#001E2B] text-[#00ED64] rounded-r-lg px-3 py-2 hover:bg-[#001E2B]/80 transition-colors"
              >
                <Search size={15} />
              </button>
            </div>
            {search && (
              <button
                type="button"
                onClick={clearSearch}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-2.5 py-2 transition-colors"
              >
                <X size={12} /> Clear search
              </button>
            )}
          </div>

          {/* Dropdowns row */}
          <div className="flex gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setNameInput('');
                  setSearch('');
                  setStatusFilter('');
                  setTypeFilter('');
                  setPage(1);
                  load(token, partyRef, 1, limit, '', '', '');
                }}
                className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800 border border-red-200 rounded-lg px-2.5 py-1.5 transition-colors"
              >
                <X size={12} /> Clear all filters
              </button>
            )}
          </div>
        </div>

        {/* Accounts list */}
        {!ready ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="bg-white rounded-xl border overflow-hidden">
            {loading && (
              <div className="px-5 py-2 text-xs text-gray-400 border-b bg-gray-50">Refreshing…</div>
            )}

            {accounts.length === 0 && !loading ? (
              <div className="p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
                  <Landmark size={22} className="text-gray-400" />
                </div>
                <p className="text-sm text-gray-500">
                  {hasFilters ? 'No accounts match the current filters.' : 'No payout accounts registered yet.'}
                </p>
                {!hasFilters && (
                  <button
                    type="button"
                    onClick={() => setShowRegister(true)}
                    className="inline-flex items-center gap-2 text-sm text-[#001E2B] font-medium border border-[#001E2B] rounded-lg px-4 py-2 hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors"
                  >
                    <Plus size={14} /> Register first account
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {accounts.map((acc) => {
                  const label = acc.payoutAccountAlias || acc.payoutAccountBankName || acc.payoutAccountInstanceReference;
                  return (
                    <Link
                      key={acc.payoutAccountInstanceReference}
                      href={`/system/accounts/${acc.payoutAccountInstanceReference}`}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors group"
                    >
                      {/* Icon */}
                      <div className="w-9 h-9 rounded-lg bg-[#001E2B]/8 flex items-center justify-center shrink-0 group-hover:bg-[#001E2B] transition-colors">
                        <Landmark size={16} className="text-[#001E2B] group-hover:text-[#00ED64] transition-colors" />
                      </div>

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-gray-900 truncate">{label}</span>
                          {acc.payoutAccountIsDefault && (
                            <span className="inline-flex items-center gap-0.5 text-xs text-amber-500">
                              <Star size={11} className="fill-amber-400 text-amber-400" /> Default
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 flex-wrap">
                          <span>{TYPE_LABELS[acc.payoutAccountType] ?? acc.payoutAccountType}</span>
                          <span className="text-gray-300">·</span>
                          <span>{acc.payoutAccountCurrency}</span>
                          <span className="text-gray-300">·</span>
                          <span>{RAIL_LABELS[acc.payoutAccountPreferredRail] ?? acc.payoutAccountPreferredRail}</span>
                          {acc.payoutAccountCountryCode && (
                            <>
                              <span className="text-gray-300">·</span>
                              <span>{acc.payoutAccountCountryCode}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Right side */}
                      <div className="flex items-center gap-3 shrink-0">
                        <StatusBadge status={acc.payoutAccountStatus} />
                        <span className="text-xs text-gray-400 hidden sm:block">{fmtDate(acc.recordCreatedDateTime)}</span>
                        <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {total > 0 && (
              <div className="px-5 py-3 border-t bg-gray-50">
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  total={total}
                  limit={limit}
                  onPageChange={handlePageChange}
                  onLimitChange={handleLimitChange}
                  limitOptions={[10, 20, 50]}
                  noun="accounts"
                  variant="light"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Register Account modal (C2) */}
      {showRegister && (
        <RegisterAccountModal
          partyRef={partyRef}
          token={token}
          onClose={() => setShowRegister(false)}
          onCreated={handleRefresh}
        />
      )}
    </RequirePermission>
  );
}

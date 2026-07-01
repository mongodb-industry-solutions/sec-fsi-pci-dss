'use client';
// BIAN SD-66: Payout Account Arrangement — Customer Accounts Page (v17)
// PCI DSS Req 3.3: IBAN encrypted at rest with QE:none (not searchable, never indexed).
// PCI DSS Req 7: customer can only view/manage their own accounts (own-scope enforced in backend).

import { useState, useEffect, useCallback } from 'react';
import { Landmark, Wallet, CheckCircle2, XCircle, Clock, RefreshCw, Star, StarOff, Trash2, Plus } from 'lucide-react';
import { api } from '../../../lib/api';
import { getToken, decodeToken } from '../../../lib/auth';
import { RequirePermission } from '../../../components/RequirePermission';
import { SectionHeader } from '../../../components/SectionHeader';
import { Pagination } from '../../../components/Pagination';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PayoutAccount {
  payoutAccountInstanceReference: string;
  payoutAccountType: string;
  payoutAccountStatus: string;
  payoutAccountCurrency: string;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
  payoutAccountIsDefault: boolean;
  payoutAccountPreferredRail: string;
  payoutAccountBalance?: {
    availableAmount: number;
    pendingAmount: number;
    reservedAmount: number;
    currency: string;
  };
  recordCreatedDateTime: string;
}

type AccountStatus = 'active' | 'suspended' | 'closed' | '';

const STATUS_LABELS: Record<string, string> = {
  active:    'Active',
  suspended: 'Suspended',
  closed:    'Closed',
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

const PAGE_SIZE = 10;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = {
    active:    { icon: CheckCircle2, cls: 'bg-green-50 text-green-700 border-green-200' },
    suspended: { icon: Clock,        cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    closed:    { icon: XCircle,      cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  }[status] ?? { icon: Clock, cls: 'bg-gray-100 text-gray-500 border-gray-200' };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      <Icon size={11} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

interface AccountCardProps {
  account: PayoutAccount;
  onSetDefault: (ref: string) => void;
  onClose: (ref: string) => void;
  busy: string | null;
}

function AccountCard({ account, onSetDefault, onClose, busy }: AccountCardProps) {
  const bal = account.payoutAccountBalance;
  const isBusy = busy === account.payoutAccountInstanceReference;
  const isActive = account.payoutAccountStatus === 'active';

  return (
    <div className={`bg-white rounded-xl border p-4 space-y-3 transition-all ${
      account.payoutAccountIsDefault ? 'border-[#001E2B]/30 shadow-sm' : 'border-gray-200'
    }`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1.5 rounded-lg shrink-0 ${
            account.payoutAccountType === 'internal_ledger' ? 'bg-[#001E2B]/10' : 'bg-blue-50'
          }`}>
            {account.payoutAccountType === 'internal_ledger'
              ? <Wallet size={14} className="text-[#001E2B]" />
              : <Landmark size={14} className="text-blue-600" />
            }
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-gray-900 truncate">
              {account.payoutAccountAlias ?? TYPE_LABELS[account.payoutAccountType] ?? account.payoutAccountType}
            </p>
            <p className="text-xs text-gray-400">
              {RAIL_LABELS[account.payoutAccountPreferredRail] ?? account.payoutAccountPreferredRail}
              {account.payoutAccountBankName ? ` · ${account.payoutAccountBankName}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {account.payoutAccountIsDefault && (
            <span className="text-xs font-medium bg-[#001E2B] text-[#00ED64] px-2 py-0.5 rounded-full">Default</span>
          )}
          <StatusBadge status={account.payoutAccountStatus} />
        </div>
      </div>

      {/* Balance panel (v17: PSP internal ledger balance) */}
      {bal && (
        <div className="grid grid-cols-3 gap-2 bg-gray-50 rounded-lg p-3">
          <div className="text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Available</p>
            <p className="text-sm font-semibold text-green-700 mt-0.5">{fmtAmount(bal.availableAmount, bal.currency)}</p>
          </div>
          <div className="text-center border-x border-gray-200">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Pending</p>
            <p className="text-sm font-semibold text-amber-700 mt-0.5">{fmtAmount(bal.pendingAmount, bal.currency)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Reserved</p>
            <p className="text-sm font-semibold text-gray-600 mt-0.5">{fmtAmount(bal.reservedAmount, bal.currency)}</p>
          </div>
        </div>
      )}

      {/* Currency + account ref */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span className="font-medium text-gray-600">{account.payoutAccountCurrency}</span>
        <span className="font-mono truncate max-w-[180px]">{account.payoutAccountInstanceReference}</span>
      </div>

      {/* Actions (only for active accounts) */}
      {isActive && (
        <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
          {!account.payoutAccountIsDefault && (
            <button
              onClick={() => onSetDefault(account.payoutAccountInstanceReference)}
              disabled={isBusy}
              className="flex items-center gap-1.5 text-xs font-medium text-[#001E2B] bg-[#001E2B]/5 hover:bg-[#001E2B]/10 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {isBusy ? <RefreshCw size={12} className="animate-spin" /> : <Star size={12} />}
              Set Default
            </button>
          )}
          <button
            onClick={() => onClose(account.payoutAccountInstanceReference)}
            disabled={isBusy}
            className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ml-auto"
          >
            {isBusy ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function AccountsPageContent() {
  const [partyRef, setPartyRef]       = useState<string | null>(null);
  const [token, setToken]             = useState('');

  const [accounts, setAccounts]       = useState<PayoutAccount[]>([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [loading, setLoading]         = useState(true);
  const [filterStatus, setFilterStatus] = useState<AccountStatus>('active');
  const [busy, setBusy]               = useState<string | null>(null);
  const [notification, setNotification] = useState<{ msg: string; ok: boolean } | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Read partyRef from JWT on mount
  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    const decoded = t ? decodeToken(t) : null;
    if (decoded?.partyRef) setPartyRef(decoded.partyRef);
  }, []);

  function notify(msg: string, ok = true) {
    setNotification({ msg, ok });
    setTimeout(() => setNotification(null), 3500);
  }

  const loadAccounts = useCallback(async (targetPage: number) => {
    if (!partyRef || !token) return;
    setLoading(true);
    try {
      const res = await api.accounts.list(partyRef, token, {
        status: filterStatus || undefined,
        page: targetPage,
        limit: PAGE_SIZE,
      });
      setAccounts(res.results);
      setTotal(res.total);
    } catch {
      setAccounts([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [partyRef, token, filterStatus]);

  // Reload when filter changes or partyRef is resolved
  useEffect(() => {
    if (!partyRef) return;
    setPage(1);
    loadAccounts(1);
  }, [partyRef, filterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePageChange(newPage: number) {
    setPage(newPage);
    loadAccounts(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSetDefault(accountRef: string) {
    if (!partyRef || !token) return;
    setBusy(accountRef);
    try {
      await api.accounts.setDefault(partyRef, accountRef, token);
      notify('Default account updated');
      loadAccounts(page);
    } catch (e: unknown) {
      notify((e as Error).message ?? 'Failed to update default account', false);
    } finally {
      setBusy(null);
    }
  }

  async function handleClose(accountRef: string) {
    if (!partyRef || !token) return;
    if (!window.confirm('Close this payout account? This action cannot be undone.')) return;
    setBusy(accountRef);
    try {
      await api.accounts.close(partyRef, accountRef, token);
      notify('Account closed');
      loadAccounts(page);
    } catch (e: unknown) {
      notify((e as Error).message ?? 'Failed to close account', false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Landmark}
        title="Payout Accounts"
        description="Manage your bank accounts and PSP wallets for receiving payouts"
        debugInfo="BIAN SD-66 Payout Account Arrangement · PCI DSS Req 3.3 (IBAN QE:none, AES-256-CBC)"
        info="IBAN and routing numbers are encrypted at rest with MongoDB Queryable Encryption and are never returned in API responses. Balances shown are from the PSP internal ledger."
        actions={
          <button
            disabled
            title="Self-service account registration coming in a future iteration"
            className="flex items-center gap-1.5 text-xs font-medium text-gray-400 border border-gray-200 bg-white px-3 py-1.5 rounded-lg cursor-not-allowed"
          >
            <Plus size={13} />
            Add Account
          </button>
        }
      />

      {/* Toast notification */}
      {notification && (
        <div className={`rounded-lg px-3 py-2 text-sm font-medium ${
          notification.ok
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {notification.msg}
        </div>
      )}

      {/* Filters + count */}
      <div className="flex flex-wrap gap-3 items-center">
        <span className="text-sm text-gray-500">Filter:</span>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as AccountStatus)}
          className="border rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">All Status</option>
          {(['active', 'suspended', 'closed'] as AccountStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500 ml-auto">
          {total} account{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Account cards grid */}
      {loading ? (
        <div className="text-center py-10 text-gray-400">Loading accounts…</div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 p-10 text-center">
          <Landmark size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No payout accounts found</p>
          {filterStatus && (
            <button onClick={() => setFilterStatus('')} className="mt-2 text-xs text-[#001E2B] underline">
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accounts.map((account) => (
              <AccountCard
                key={account.payoutAccountInstanceReference}
                account={account}
                onSetDefault={handleSetDefault}
                onClose={handleClose}
                busy={busy}
              />
            ))}
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            limit={PAGE_SIZE}
            onPageChange={handlePageChange}
            noun="accounts"
          />
        </>
      )}

      {/* Debug: no partyRef */}
      {!partyRef && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-700">
          No partyRef in JWT. This page requires a customer account with a party record.
        </div>
      )}
    </div>
  );
}

export default function AccountsPage() {
  return (
    <RequirePermission resource="accounts" action="view">
      <AccountsPageContent />
    </RequirePermission>
  );
}

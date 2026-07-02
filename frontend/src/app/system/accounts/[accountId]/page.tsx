'use client';
// BIAN SD-66: Payout Account Detail — Customer Account Detail Page (v17 Phase C)
// PCI DSS Req 3.3: IBAN never shown in full. GDPR: account holder data visible to data subject only.
// PCI DSS Req 7: partyRef from JWT must match account's partyInstanceReference (enforced backend).

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Landmark, CheckCircle2, XCircle, Clock, Star, Trash2, Save, X } from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { Breadcrumb, type Crumb } from '../../../../components/Breadcrumb';
import { Pagination } from '../../../../components/Pagination';
import { RequirePermission } from '../../../../components/RequirePermission';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';
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
  payoutAccountBalance?: {
    availableAmount: number;
    pendingAmount: number;
    reservedAmount: number;
    currency: string;
  };
  recordCreatedDateTime: string;
}

interface AccountMovement {
  movementId: string;
  movementType: string;
  direction: 'debit' | 'credit';
  amount: number;
  currency: string;
  description: string;
  counterpartyName?: string;
  counterpartyRef?: string;
  status: string;
  occurredAt: string;
  sourceCollection: string;
  sourceRef: string;
}

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

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  card_debit:          'Card Debit',
  card_refund:         'Card Refund',
  payout_disbursement: 'Payout',
  balance_credit:      'Credit',
};

const RAIL_LABELS: Record<string, string> = {
  sepa:            'SEPA',
  ach:             'ACH',
  local_bank:      'Local Bank',
  internal_wallet: 'Internal Wallet',
  internal_ledger: 'Internal Ledger',
};

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

function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount / 100);
}

function fmtDate(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const MOVEMENT_LIMIT = 20;

export default function AccountDetailPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params?.accountId as string;
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useNotify();

  const [token, setToken] = useState('');
  const [partyRef, setPartyRef] = useState('');
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [ready, setReady] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Edit state
  const [alias, setAlias] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);

  // Movements state
  const [movements, setMovements] = useState<AccountMovement[]>([]);
  const [movTotal, setMovTotal] = useState(0);
  const [movPage, setMovPage] = useState(1);
  const [movDirection, setMovDirection] = useState('');
  const [movType, setMovType] = useState('');
  const [movLoading, setMovLoading] = useState(false);

  const loadMovements = useCallback(async (t: string, pRef: string, aRef: string, page: number, direction: string, type: string) => {
    setMovLoading(true);
    try {
      const r = await api.accounts.movements(pRef, aRef, t, {
        page,
        limit: MOVEMENT_LIMIT,
        ...(direction ? { direction: direction as 'debit' | 'credit' } : {}),
        ...(type ? { type } : {}),
      });
      setMovements(r.movements as unknown as AccountMovement[]);
      setMovTotal(r.total);
    } catch {
      // non-blocking
    } finally {
      setMovLoading(false);
    }
  }, []);

  const load = useCallback(async (t: string, pRef: string) => {
    try {
      const a = await api.accounts.get(pRef, accountId, t) as unknown as PayoutAccount;
      setAccount(a);
      setAlias(a.payoutAccountAlias ?? '');
      setIsDefault(a.payoutAccountIsDefault);
      await loadMovements(t, pRef, accountId, 1, '', '');
    } catch {
      setNotFound(true);
    }
  }, [accountId, loadMovements]);

  useEffect(() => {
    const t = getToken() ?? '';
    const decoded = t ? decodeToken(t) : null;
    const pRef = decoded?.partyRef ?? '';
    if (!t || !pRef) { router.replace('/system'); return; }
    setToken(t);
    setPartyRef(pRef);
    load(t, pRef).finally(() => setReady(true));
  }, [router, load]);

  async function handleSave() {
    if (!account) return;
    setSaving(true);
    try {
      await api.accounts.update(partyRef, accountId, { payoutAccountAlias: alias, payoutAccountIsDefault: isDefault }, token);
      notify('Account updated.', 'success');
      setAccount((prev) => prev ? { ...prev, payoutAccountAlias: alias, payoutAccountIsDefault: isDefault } : prev);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update account.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleClose() {
    if (!account) return;
    const ok = await confirm({
      title: 'Close this account?',
      message: `${account.payoutAccountAlias || account.payoutAccountBankName || 'This account'} will be closed. This action cannot be undone.`,
      confirmLabel: 'Close account',
      tone: 'danger',
    });
    if (!ok) return;
    setClosing(true);
    try {
      await api.accounts.close(partyRef, accountId, token);
      notify('Account closed.', 'success');
      router.push('/system/accounts');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to close account.', 'error');
      setClosing(false);
    }
  }

  function handleMovFilter(direction: string, type: string, page: number) {
    setMovDirection(direction);
    setMovType(type);
    setMovPage(page);
    loadMovements(token, partyRef, accountId, page, direction, type);
  }

  const accountLabel = account?.payoutAccountAlias || account?.payoutAccountBankName || 'Account';
  const crumbs: Crumb[] = [
    { label: 'Home', href: '/system' },
    { label: 'Accounts', href: '/system/accounts' },
    { label: accountLabel },
  ];

  const aliasChanged = alias !== (account?.payoutAccountAlias ?? '');
  const defaultChanged = isDefault !== (account?.payoutAccountIsDefault ?? false);
  const dirty = aliasChanged || defaultChanged;

  return (
    <RequirePermission resource="accounts" action="view">
      <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
        {ready && <Breadcrumb items={crumbs} />}

        {!ready ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : notFound || !account ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
            This account could not be found or you do not have access to it.
            <Link href="/system/accounts" className="ml-2 underline">Back to accounts</Link>
          </div>
        ) : (
          <>
            {/* Account header */}
            <div className="bg-white rounded-xl border p-5 space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-lg bg-[#001E2B] flex items-center justify-center shrink-0">
                    <Landmark size={22} className="text-[#00ED64]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="text-lg font-bold text-[#001E2B] truncate">{accountLabel}</h1>
                      {account.payoutAccountIsDefault && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-amber-500">
                          <Star size={12} className="fill-amber-400 text-amber-400" /> Default
                        </span>
                      )}
                    </div>
                    {account.payoutAccountBankName && (
                      <p className="text-sm text-gray-500 mt-0.5">
                        {/* PCI Req 3.3: display bank name only, never full IBAN */}
                        {account.payoutAccountBankName}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200 font-medium">
                    {TYPE_LABELS[account.payoutAccountType] ?? account.payoutAccountType}
                  </span>
                  <StatusBadge status={account.payoutAccountStatus} />
                </div>
              </div>

              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm pt-2 border-t">
                <div>
                  <dt className="text-xs text-gray-500">Currency</dt>
                  <dd className="font-medium text-gray-800">{account.payoutAccountCurrency}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Rail</dt>
                  <dd className="font-medium text-gray-800">{RAIL_LABELS[account.payoutAccountPreferredRail] ?? account.payoutAccountPreferredRail}</dd>
                </div>
                {account.payoutAccountCountryCode && (
                  <div>
                    <dt className="text-xs text-gray-500">Country</dt>
                    <dd className="font-medium text-gray-800">{account.payoutAccountCountryCode}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-gray-500">Registered</dt>
                  <dd className="font-medium text-gray-800">{fmtDate(account.recordCreatedDateTime)}</dd>
                </div>
              </dl>
            </div>

            {/* Balance panel */}
            {account.payoutAccountBalance && (
              <div className="bg-white rounded-xl border p-5 space-y-3">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">PSP Internal Ledger Balance</h2>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Available', amount: account.payoutAccountBalance.availableAmount, cls: 'text-green-700' },
                    { label: 'Pending',   amount: account.payoutAccountBalance.pendingAmount,   cls: 'text-amber-700' },
                    { label: 'Reserved',  amount: account.payoutAccountBalance.reservedAmount,  cls: 'text-gray-600' },
                  ].map(({ label, amount, cls }) => (
                    <div key={label} className="bg-gray-50 rounded-lg p-3 text-center">
                      <div className={`text-base font-bold ${cls}`}>{fmtAmount(amount, account.payoutAccountBalance!.currency)}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Edit section */}
            {account.payoutAccountStatus !== 'closed' && (
              <div className="bg-white rounded-xl border p-5 space-y-4">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Edit account</h2>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nickname / alias</label>
                    <input
                      type="text"
                      value={alias}
                      onChange={(e) => setAlias(e.target.value)}
                      placeholder="e.g. Main savings"
                      maxLength={60}
                      className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isDefault}
                        onChange={(e) => setIsDefault(e.target.checked)}
                        className="w-4 h-4 accent-[#00ED64]"
                      />
                      <span className="text-sm text-gray-700">Set as primary account</span>
                    </label>
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={saving || !dirty}
                    className="inline-flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 text-sm"
                  >
                    <Save size={14} />
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            )}

            {/* Movements */}
            <div className="bg-white rounded-xl border p-5 space-y-4">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Account Movements</h2>

              {/* Movement filters */}
              <div className="flex flex-wrap gap-2">
                <select
                  value={movDirection}
                  onChange={(e) => handleMovFilter(e.target.value, movType, 1)}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none"
                >
                  <option value="">All directions</option>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
                <select
                  value={movType}
                  onChange={(e) => handleMovFilter(movDirection, e.target.value, 1)}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none"
                >
                  <option value="">All types</option>
                  <option value="card_debit">Card Debit</option>
                  <option value="card_refund">Card Refund</option>
                  <option value="payout_disbursement">Payout</option>
                  <option value="balance_credit">Balance Credit</option>
                </select>
                {(movDirection || movType) && (
                  <button
                    onClick={() => handleMovFilter('', '', 1)}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-2 py-1.5"
                  >
                    <X size={11} /> Clear
                  </button>
                )}
              </div>

              {movLoading ? (
                <div className="text-sm text-gray-400 py-4 text-center">Loading movements…</div>
              ) : movements.length === 0 ? (
                <div className="text-sm text-gray-400 py-4 text-center">No movements yet for this account.</div>
              ) : (
                <div className="divide-y">
                  {movements.map((m) => (
                    <div key={m.movementId} className="py-3 flex items-start justify-between gap-3 text-sm">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className={`mt-0.5 inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${
                          m.direction === 'credit'
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-red-50 text-red-700 border-red-200'
                        }`}>
                          {m.direction === 'credit' ? '+' : '-'}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                              {MOVEMENT_TYPE_LABELS[m.movementType] ?? m.movementType}
                            </span>
                            {m.counterpartyName && (
                              <span className="text-gray-700 truncate">{m.counterpartyName}</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">{m.description}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{fmtDate(m.occurredAt)}</div>
                        </div>
                      </div>
                      <div className={`font-medium tabular-nums shrink-0 ${m.direction === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
                        {m.direction === 'credit' ? '+' : '-'}{fmtAmount(m.amount, m.currency)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {movTotal > MOVEMENT_LIMIT && (
                <Pagination
                  page={movPage}
                  totalPages={Math.ceil(movTotal / MOVEMENT_LIMIT)}
                  total={movTotal}
                  limit={MOVEMENT_LIMIT}
                  onPageChange={(p) => handleMovFilter(movDirection, movType, p)}
                  noun="movements"
                  variant="light"
                />
              )}
            </div>

            {/* Danger zone */}
            {account.payoutAccountStatus !== 'closed' && (
              <div className="bg-white rounded-xl border border-red-200 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Trash2 size={14} className="text-red-500" />
                  <h2 className="font-semibold text-gray-800 text-sm">Danger zone</h2>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Close this account</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Closes the account permanently (BIAN SD-66 lifecycle). No payout will be sent to a closed account.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={closing}
                    className="shrink-0 border border-red-300 text-red-600 hover:bg-red-50 font-medium px-4 py-2 rounded-lg transition-colors text-sm disabled:opacity-50"
                  >
                    {closing ? 'Closing…' : 'Close account'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </RequirePermission>
  );
}

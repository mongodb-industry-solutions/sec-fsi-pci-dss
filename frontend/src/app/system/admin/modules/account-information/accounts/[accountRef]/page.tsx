'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Landmark, CreditCard, ArrowLeft, Pencil, Save, X, Trash2, ShieldAlert, Check, Search, UserCog } from 'lucide-react';
import { api, type PartyOwnerResult } from '../../../../../../../lib/api';
import { Pagination } from '../../../../../../../components/Pagination';
import { SensitiveReveal } from '../../../../../../../components/SensitiveReveal';
import { getToken } from '../../../../../../../lib/auth';
import { useDebugMode } from '../../../../../../../lib/debugMode';
import { useConfirm, useNotify } from '../../../../../../../components/ui/ConfirmProvider';
import { Breadcrumb } from '../../../../../../../components/Breadcrumb';
import { RequirePermission } from '../../../../../../../components/RequirePermission';
import { useEffectivePermissions } from '../../../../../../../lib/permissions';
import { formatAmount } from '../../../../../../../lib/money';

// v29.2 global payout-account-administration DETAIL page (built-in account-information module).
// Dedicated page (not a modal) so the operations officer sees every QE-stripped field with room to act.
// QE/GDPR: IBAN and routing number are NEVER returned here (boolean presence hints only); the raw IBAN
// reveal stays on its dedicated party-scoped route. PCI DSS + (mutations audited server-side).

const LIST_HREF = '/system/admin/modules/account-information?tab=accounts';

interface AccountDetail {
  payoutAccountInstanceReference?: string;
  partyInstanceReference?: string;
  payoutAccountType?: string;
  payoutAccountStatus?: string;
  ownerName?: string | null;
  payoutAccountCurrency?: string;
  payoutAccountCountryCode?: string;
  payoutAccountPreferredRail?: string;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
  payoutAccountHolderName?: string;
  payoutAccountBicSwift?: string;
  payoutAccountCorrespondentBic?: string;
  payoutAccountBankAddress?: string;
  payoutAccountIsDefault?: boolean;
  payoutAccountHasIban?: boolean;
  payoutAccountHasRoutingNumber?: boolean;
  payoutAccountBalance?: { availableAmount: number; pendingAmount: number; reservedAmount: number; currency: string };
  recordCreatedDateTime?: string;
  recordUpdatedDateTime?: string;
}

interface LinkedCard {
  paymentCardInstanceReference: string;
  paymentCardMaskedPanDisplay: string;
  paymentCardBin?: string | null;
  paymentCardLast4?: string | null;
  paymentCardNetwork?: string | null;
  paymentCardStatus: string;
  paymentCardAlias?: string | null;
}

const CARD_NETWORKS = ['VISA', 'MASTERCARD', 'AMEX', 'ELO'] as const;
const CARD_STATUSES = ['issued', 'active', 'pending_activation', 'blocked', 'suspended', 'revoked', 'expired'] as const;

const TYPE_LABELS: Record<string, string> = { bank_account: 'Bank Account', wallet: 'Wallet', internal_ledger: 'PSP Ledger' };

function statusClass(status?: string): string {
  switch (status) {
    case 'active': return 'bg-green-100 text-green-700';
    case 'pending_validation': return 'bg-blue-100 text-blue-700';
    case 'suspended': return 'bg-amber-100 text-amber-700';
    case 'closed': return 'bg-gray-100 text-gray-500';
    default: return 'bg-gray-100 text-gray-500';
  }
}

function fmtDate(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '-' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(amount?: number, currency?: string): string {
  if (typeof amount !== 'number') return '-';
  try {
    return formatAmount(amount, currency || 'EUR', { minimumFractionDigits: 2 });
  } catch { return `${amount} ${currency ?? ''}`; }
}

function AccountAdminDetail() {
  const params = useParams<{ accountRef: string }>();
  const accountRef = params?.accountRef as string;
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useNotify();
  const { debugMode } = useDebugMode();
  // The page is wrapped in accounts:view, but edit/close call accounts:manage endpoints. Render a
  // read-only detail for view-only roles (e.g. security_auditor) instead of always-failing actions.
  const { can } = useEffectivePermissions();
  const canManage = can('accounts', 'manage');

  const token = getToken() ?? '';
  const [acct, setAcct] = useState<AccountDetail | null>(null);
  const [ready, setReady] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [managedExternally, setManagedExternally] = useState(false);

  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState('');
  const [bankName, setBankName] = useState('');
  const [holderName, setHolderName] = useState('');
  const [bicSwift, setBicSwift] = useState('');
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reassigning, setReassigning] = useState(false);

  const syncForm = useCallback((a: AccountDetail) => {
    setAlias(a.payoutAccountAlias ?? '');
    setBankName(a.payoutAccountBankName ?? '');
    setHolderName(a.payoutAccountHolderName ?? '');
    setBicSwift(a.payoutAccountBicSwift ?? '');
  }, []);

  const load = useCallback(async () => {
    if (!token || !accountRef) { setReady(true); return; }
    try {
      const a = await api.modules.accountAdmin.get(accountRef, token) as AccountDetail;
      setAcct(a);
      syncForm(a);
    } catch (e) {
      if (e instanceof Error && e.message === 'managed_externally') setManagedExternally(true);
      else setNotFound(true);
    } finally {
      setReady(true);
    }
  }, [token, accountRef, syncForm]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.modules.accountAdmin.update(accountRef, {
        payoutAccountAlias: alias.trim(),
        payoutAccountBankName: bankName.trim(),
        payoutAccountHolderName: holderName.trim(),
        payoutAccountBicSwift: bicSwift.trim(),
      }, token) as AccountDetail;
      setAcct((prev) => prev ? { ...prev, ...updated } : prev);
      setEditing(false);
      notify('Account updated.', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to update account.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleClose() {
    if (!acct) return;
    const ok = await confirm({
      title: 'Close this account?',
      message: `${acct.payoutAccountAlias ?? 'This payout account'} will be closed (soft-close; the record is retained for audit).`,
      confirmLabel: 'Close account',
      tone: 'danger',
    });
    if (!ok) return;
    setClosing(true);
    try {
      await api.modules.accountAdmin.close(accountRef, token);
      notify('Account closed.', 'success');
      router.push(LIST_HREF);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to close account.', 'error');
      setClosing(false);
    }
  }

  function cancelEdit() {
    if (acct) syncForm(acct);
    setEditing(false);
  }

  async function reassignOwner(r: PartyOwnerResult) {
    if (!acct) return;
    const ok = await confirm({
      title: 'Reassign account owner?',
      message: `This payout account will be reassigned to ${r.ownerName ?? 'the selected party'}. This is a sensitive change and is audited.`,
      confirmLabel: 'Reassign owner',
      tone: 'danger',
    });
    if (!ok) return;
    setReassigning(true);
    try {
      const updated = await api.modules.accountAdmin.reassignOwner(accountRef, r.partyInstanceReference, token);
      setAcct((prev) => prev ? { ...prev, partyInstanceReference: updated.partyInstanceReference, ownerName: updated.ownerName ?? r.ownerName } : prev);
      notify('Account owner reassigned.', 'success');
    } catch (e) {
      if (e instanceof Error && e.message === 'managed_externally') notify('Capability managed by an external provider.', 'error');
      else notify(e instanceof Error ? e.message : 'Failed to reassign owner.', 'error');
    } finally {
      setReassigning(false);
    }
  }

  const label = acct?.payoutAccountAlias || acct?.payoutAccountBankName || TYPE_LABELS[acct?.payoutAccountType ?? ''] || 'Account';

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[
        { label: 'Home', href: '/system' },
        { label: 'Modules', href: '/system/admin/modules' },
        { label: 'Account Information', href: '/system/admin/modules/account-information' },
        { label: 'Accounts', href: LIST_HREF },
        { label },
      ]} />

      <Link href={LIST_HREF} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft size={14} /> Back to accounts
      </Link>

      {!ready ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : managedExternally ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3 text-sm text-amber-800">
          <ShieldAlert size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <p>This capability is managed by an external provider; built-in administration is disabled.</p>
        </div>
      ) : notFound || !acct ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          This account could not be found.
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-lg bg-[#001E2B] flex items-center justify-center shrink-0">
                  <Landmark size={22} className="text-[#00ED64]" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-[#001E2B] truncate">{label}</h1>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {TYPE_LABELS[acct.payoutAccountType ?? ''] ?? acct.payoutAccountType}
                    {acct.payoutAccountCurrency ? ` · ${acct.payoutAccountCurrency}` : ''}
                  </p>
                </div>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded font-medium ${statusClass(acct.payoutAccountStatus)}`}>
                {acct.payoutAccountStatus}
              </span>
            </div>
          </div>

          {/* Account details */}
          <div className="bg-white rounded-xl border p-5 space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Account details</h2>
            <dl className="divide-y text-sm">
              <DetailRow label="Type" value={TYPE_LABELS[acct.payoutAccountType ?? ''] ?? acct.payoutAccountType} />
              <DetailRow label="Status" value={acct.payoutAccountStatus} />
              <DetailRow label="Currency" value={acct.payoutAccountCurrency} mono />
              <DetailRow label="Country" value={acct.payoutAccountCountryCode} mono />
              <DetailRow label="Preferred rail" value={acct.payoutAccountPreferredRail} />
              <DetailRow label="Default" value={acct.payoutAccountIsDefault ? 'Yes' : 'No'} />
              <DetailRow label="Bank name" value={acct.payoutAccountBankName} />
              <DetailRow label="Holder name" value={acct.payoutAccountHolderName} />
              <DetailRow label="BIC / SWIFT" value={acct.payoutAccountBicSwift} mono />
              <DetailRow label="Correspondent BIC" value={acct.payoutAccountCorrespondentBic} mono />
              <DetailRow label="Bank address" value={acct.payoutAccountBankAddress} />
              {acct.payoutAccountHasIban ? (
                <SensitiveReveal label="IBAN"
                  hint={debugMode ? 'QE-encrypted; ephemeral reveal' : undefined}
                  fetchValue={async () => (await api.modules.accountAdmin.revealIban(accountRef, token)).payoutAccountIban} />
              ) : (
                <IbanHintRow present={acct.payoutAccountHasIban} debug={debugMode} />
              )}
              {acct.payoutAccountHasRoutingNumber === false ? (
                <DetailRow label="Routing number" value="None"
                  hint={debugMode ? 'QE-encrypted; never returned' : undefined} />
              ) : (
                // On demand routing reveal (GDPR need-to-know, re-hideable, audited). Mirrors IBAN.
                // When the presence hint is absent we still offer it and handle a 404 gracefully.
                <SensitiveReveal label="Routing number"
                  hint={debugMode ? 'QE-encrypted; ephemeral reveal' : undefined}
                  fetchValue={async () => (await api.modules.accountAdmin.revealRouting(accountRef, token)).payoutAccountRoutingNumber} />
              )}
              {/* Owner: derived party name (need-to-know, audited). Distinct from the legal holder name. */}
              <DetailRow label="Owner" value={acct.ownerName ?? undefined}
                hint={debugMode ? 'derived from party; need-to-know' : undefined} />
              <DetailRow label="Party" value={acct.partyInstanceReference} mono />
              <DetailRow label="Created" value={fmtDate(acct.recordCreatedDateTime)} />
              {acct.recordUpdatedDateTime && (
                <DetailRow label="Last updated" value={fmtDate(acct.recordUpdatedDateTime)} />
              )}
            </dl>
            {debugMode && (
              <p className="text-xs text-gray-400 font-mono pt-1">
                payoutAccountInstanceReference: {acct.payoutAccountInstanceReference}
              </p>
            )}
            <p className="text-xs text-gray-400 pt-1">IBAN and routing number are QE-encrypted at rest. The IBAN reveal is on demand (need-to-know, re-hideable) and audited; the routing number is never returned (GDPR Art. 5/32, PCI DSS).</p>
          </div>

          {/* Linked cards funded by this account (display-safe; no full PAN / CVV). */}
          <LinkedCardsPanel accountRef={accountRef} token={token} notify={notify} />

          {/* Balance */}
          {acct.payoutAccountBalance && (
            <div className="bg-white rounded-xl border p-5 space-y-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Balance</h2>
              <dl className="divide-y text-sm">
                <DetailRow label="Available" value={fmtMoney(acct.payoutAccountBalance.availableAmount, acct.payoutAccountBalance.currency)} mono />
                <DetailRow label="Pending" value={fmtMoney(acct.payoutAccountBalance.pendingAmount, acct.payoutAccountBalance.currency)} mono />
                <DetailRow label="Reserved" value={fmtMoney(acct.payoutAccountBalance.reservedAmount, acct.payoutAccountBalance.currency)} mono />
              </dl>
            </div>
          )}

          {/* Editable metadata */}
          <div className="bg-white rounded-xl border p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Editable details</h2>
              {!canManage ? null : !editing ? (
                <button onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors">
                  <Pencil size={13} /> Edit
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={cancelEdit} disabled={saving}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                    <X size={13} /> Cancel
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#001E2B] text-[#00ED64] hover:opacity-90 disabled:opacity-50 transition-opacity">
                    <Save size={13} /> {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>
            {!editing ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <FieldView label="Alias" value={acct.payoutAccountAlias} />
                <FieldView label="Bank name" value={acct.payoutAccountBankName} />
                <FieldView label="Holder name" value={acct.payoutAccountHolderName} />
                <FieldView label="BIC / SWIFT" value={acct.payoutAccountBicSwift} />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <EditField label="Alias" value={alias} onChange={setAlias} />
                <EditField label="Bank name" value={bankName} onChange={setBankName} />
                <EditField label="Holder name" value={holderName} onChange={setHolderName} />
                <EditField label="BIC / SWIFT" value={bicSwift} onChange={(v) => setBicSwift(v.toUpperCase())} mono />
              </div>
            )}
          </div>

          {/* Owner reassignment (operations_officer, accounts:manage). Sensitive; confirmed + audited. */}
          {canManage && acct.payoutAccountStatus !== 'closed' && (
            <div className="bg-white rounded-xl border p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
                  <UserCog size={14} className="text-amber-600" />
                </div>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Reassign owner</h2>
              </div>
              <p className="text-xs text-gray-400">
                Current owner: <span className="text-gray-700">{acct.ownerName ?? 'Unnamed party'}</span>. Search for a party to reassign this account; the change is confirmed and audited.
              </p>
              <PartySearch token={token} disabled={reassigning} onPick={reassignOwner} notify={notify} />
            </div>
          )}

          {/* Danger zone */}
          {canManage && acct.payoutAccountStatus !== 'closed' && (
            <div className="bg-white rounded-xl border border-red-100 p-5 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium text-gray-800">Close this account</p>
                <p className="text-xs text-gray-400">The account is closed (soft-close); the record is retained for audit.</p>
              </div>
              <button onClick={handleClose} disabled={closing}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
                <Trash2 size={15} /> {closing ? 'Closing…' : 'Close account'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono, hint }: { label: string; value?: string; mono?: boolean; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="flex items-center gap-2 min-w-0">
        {hint && <span className="text-xs text-gray-300 font-mono hidden sm:inline">{hint}</span>}
        <span className={`text-gray-800 text-right truncate ${mono ? 'font-mono' : ''}`}>{value ?? '-'}</span>
      </span>
    </div>
  );
}

function IbanHintRow({ present, debug }: { present?: boolean; debug: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-gray-500 shrink-0">IBAN</span>
      <span className="flex items-center gap-2 min-w-0">
        {debug && <span className="text-xs text-gray-300 font-mono hidden sm:inline">QE-encrypted; never returned</span>}
        {present
          ? <span className="inline-flex items-center gap-1 text-green-700"><Check size={14} /> On file (encrypted)</span>
          : <span className="text-gray-400">None</span>}
      </span>
    </div>
  );
}

function FieldView({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-gray-800">{value || <span className="text-gray-400">Not set</span>}</p>
    </div>
  );
}

function EditField({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#001E2B]/20 ${mono ? 'font-mono' : ''}`} />
    </div>
  );
}

// Debounced party search: queries parties by owner name; picking a result reassigns the account.
// Reused pattern from the accounts admin panel (accountAdmin.searchParties).
function PartySearch({ token, onPick, disabled, notify }: {
  token: string;
  onPick: (r: PartyOwnerResult) => void;
  disabled?: boolean;
  notify: (m: string, t: 'success' | 'error') => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PartyOwnerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearched(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.modules.accountAdmin.searchParties(q, token);
        if (!cancelled) { setResults(r.results); setSearched(true); }
      } catch (e) {
        if (!cancelled) {
          setResults([]); setSearched(true);
          if (e instanceof Error && e.message === 'managed_externally') notify('Capability managed by an external provider.', 'error');
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, token, notify]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} disabled={disabled}
          className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm disabled:opacity-50" placeholder="Search new owner by name" />
      </div>
      {searching && <p className="text-xs text-gray-400">Searching…</p>}
      {results.length > 0 && (
        <ul className="border rounded-lg divide-y max-h-48 overflow-y-auto">
          {results.map((r) => (
            <li key={r.partyInstanceReference}>
              <button type="button" onClick={() => onPick(r)} disabled={disabled}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors disabled:opacity-50">
                <span className="text-gray-800 font-medium">{r.ownerName ?? 'Unnamed owner'}</span>
                <span className="block text-xs text-gray-400 font-mono truncate">{r.partyInstanceReference}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searched && !searching && results.length === 0 && (
        <p className="text-xs text-gray-400">No matching party.</p>
      )}
    </div>
  );
}

// Display-safe cards funded by this payout account (no full PAN / CVV). Paginated + filterable,
// mirroring the global card admin list UX (network/status selects, BIN/last4 search, shared Pagination).
// 409 managed_externally renders the standard external-provider banner.
function LinkedCardsPanel({ accountRef, token, notify }: {
  accountRef: string;
  token: string;
  notify: (m: string, t: 'success' | 'error') => void;
}) {
  const [rows, setRows] = useState<LinkedCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [managedExternally, setManagedExternally] = useState(false);

  const [network, setNetwork] = useState('');
  const [status, setStatus] = useState('');
  const [last4, setLast4] = useState('');
  const [bin, setBin] = useState('');
  // Debounced copies of the free-text search inputs (mirrors the global card admin panel, ~300ms).
  const [last4Q, setLast4Q] = useState('');
  const [binQ, setBinQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setLast4Q(last4); }, 300);
    return () => clearTimeout(t);
  }, [last4]);
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setBinQ(bin); }, 300);
    return () => clearTimeout(t);
  }, [bin]);

  const load = useCallback(async () => {
    if (!token || !accountRef) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await api.modules.accountAdmin.cards({
        accountRef, token, page, limit,
        network: network || undefined, status: status || undefined,
        last4: last4Q || undefined, bin: binQ || undefined,
      });
      setRows(r.results as LinkedCard[]);
      setTotal(r.total);
      setManagedExternally(false);
    } catch (e) {
      if (e instanceof Error && e.message === 'managed_externally') setManagedExternally(true);
      else notify(e instanceof Error ? e.message : 'Could not load linked cards.', 'error');
      setRows([]); setTotal(0);
    } finally { setLoading(false); }
  }, [token, accountRef, page, limit, network, status, last4Q, binQ, notify]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = !!(network || status || last4Q || binQ);

  return (
    <div className="bg-white rounded-xl border p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
          <CreditCard size={14} className="text-blue-600" />
        </div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Linked cards</h2>
      </div>

      {managedExternally ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3 text-sm text-amber-800">
          <ShieldAlert size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <p>This capability is managed by an external provider; built-in administration is disabled.</p>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Network</label>
              <select value={network} onChange={(e) => { setPage(1); setNetwork(e.target.value); }}
                className="border rounded-lg px-3 py-1.5 text-sm">
                <option value="">All</option>
                {CARD_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}
                className="border rounded-lg px-3 py-1.5 text-sm">
                <option value="">All</option>
                {CARD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">BIN</label>
              <input value={bin} onChange={(e) => setBin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="e.g. 411111" inputMode="numeric"
                className="w-28 border rounded-lg px-3 py-1.5 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Last 4</label>
              <input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234" inputMode="numeric"
                className="w-20 border rounded-lg px-3 py-1.5 text-sm font-mono" />
            </div>
          </div>

          {/* Results */}
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase border-b bg-gray-50">
                    <th className="py-2.5 px-4 font-medium">Masked PAN</th>
                    <th className="py-2.5 px-4 font-medium">BIN</th>
                    <th className="py-2.5 px-4 font-medium">Last 4</th>
                    <th className="py-2.5 px-4 font-medium">Network</th>
                    <th className="py-2.5 px-4 font-medium">Status</th>
                    <th className="py-2.5 px-4 font-medium">Alias</th>
                    <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="py-8 text-center text-gray-400">Loading…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={7} className="py-8 text-center text-gray-400">
                      {hasFilters ? 'No cards match these filters.' : 'No cards are funded by this account.'}
                    </td></tr>
                  ) : rows.map((c) => (
                    <tr key={c.paymentCardInstanceReference} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2.5 px-4 font-mono">{c.paymentCardMaskedPanDisplay}</td>
                      <td className="py-2.5 px-4 font-mono text-xs text-gray-500">{c.paymentCardBin ?? '-'}</td>
                      <td className="py-2.5 px-4 font-mono text-xs text-gray-500">{c.paymentCardLast4 ?? '-'}</td>
                      <td className="py-2.5 px-4">{c.paymentCardNetwork ?? '-'}</td>
                      <td className="py-2.5 px-4"><span className={`text-xs px-2 py-0.5 rounded font-medium ${statusClass(c.paymentCardStatus)}`}>{c.paymentCardStatus}</span></td>
                      <td className="py-2.5 px-4 truncate max-w-[160px]">{c.paymentCardAlias ?? '-'}</td>
                      <td className="py-2.5 px-4 text-right">
                        <Link href={`/system/admin/modules/card-issuer/cards/${encodeURIComponent(c.paymentCardInstanceReference)}`}
                          className="text-xs text-[#001E2B] font-medium hover:underline">View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > 0 && (
              <div className="px-4 border-t">
                <Pagination page={page} totalPages={totalPages} total={total} limit={limit}
                  onPageChange={setPage} onLimitChange={(l) => { setLimit(l); setPage(1); }} noun="cards" />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function AccountAdminDetailPage() {
  return (
    <RequirePermission resource="accounts" action="view">
      <AccountAdminDetail />
    </RequirePermission>
  );
}

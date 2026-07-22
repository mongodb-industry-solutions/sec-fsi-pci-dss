'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Landmark, CreditCard, ArrowLeft, Pencil, Save, X, Trash2, ShieldAlert, Check } from 'lucide-react';
import { api } from '../../../../../../../lib/api';
import { SensitiveReveal } from '../../../../../../../components/SensitiveReveal';
import { getToken } from '../../../../../../../lib/auth';
import { useDebugMode } from '../../../../../../../lib/debugMode';
import { useConfirm, useNotify } from '../../../../../../../components/ui/ConfirmProvider';
import { Breadcrumb } from '../../../../../../../components/Breadcrumb';
import { RequirePermission } from '../../../../../../../components/RequirePermission';
import { useEffectivePermissions } from '../../../../../../../lib/permissions';

// v29.2 global payout-account-administration DETAIL page (SD-66, built-in account-information module).
// Dedicated page (not a modal) so the operations officer sees every QE-stripped field with room to act.
// QE/GDPR: IBAN and routing number are NEVER returned here (boolean presence hints only); the raw IBAN
// reveal stays on its dedicated party-scoped route. PCI DSS Req 7 + Req 10 (mutations audited server-side).

const LIST_HREF = '/system/admin/modules/account-information?tab=accounts';

interface AccountDetail {
  payoutAccountInstanceReference?: string;
  partyInstanceReference?: string;
  payoutAccountType?: string;
  payoutAccountStatus?: string;
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
  paymentCardNetwork?: string | null;
  paymentCardStatus: string;
  paymentCardAlias?: string | null;
}

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
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR', minimumFractionDigits: 2 }).format(amount);
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
  const [linkedCards, setLinkedCards] = useState<LinkedCard[]>([]);
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
      // Display-safe cards funded by this account (non-blocking; no full PAN/CVV).
      api.modules.accountAdmin.cards(accountRef, token)
        .then((r) => setLinkedCards(r.results as LinkedCard[]))
        .catch(() => setLinkedCards([]));
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
              <DetailRow label="Routing number" value={acct.payoutAccountHasRoutingNumber ? 'On file (encrypted)' : 'None'}
                hint={debugMode ? 'QE-encrypted; never returned' : undefined} />
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
            <p className="text-xs text-gray-400 pt-1">IBAN and routing number are QE-encrypted at rest. The IBAN reveal is on demand (need-to-know, re-hideable) and audited; the routing number is never returned (GDPR Art. 5/32, PCI DSS Req 10).</p>
          </div>

          {/* Linked cards funded by this account (display-safe; no full PAN / CVV). */}
          <div className="bg-white rounded-xl border p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                <CreditCard size={14} className="text-blue-600" />
              </div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Linked cards</h2>
            </div>
            {linkedCards.length === 0 ? (
              <p className="text-sm text-gray-400">No cards are funded by this account.</p>
            ) : (
              <ul className="divide-y text-sm">
                {linkedCards.map((c) => (
                  <li key={c.paymentCardInstanceReference}>
                    <Link href={`/system/admin/modules/card-issuer/cards/${encodeURIComponent(c.paymentCardInstanceReference)}`}
                      className="flex items-center justify-between gap-3 py-2.5 -mx-2 px-2 rounded hover:bg-gray-50 transition-colors group">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-gray-800">{c.paymentCardMaskedPanDisplay}</span>
                        {c.paymentCardNetwork && <span className="text-xs text-gray-400">{c.paymentCardNetwork}</span>}
                        {c.paymentCardAlias && <span className="text-xs text-gray-500 truncate">{c.paymentCardAlias}</span>}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusClass(c.paymentCardStatus)}`}>{c.paymentCardStatus}</span>
                        <span className="text-xs text-[#001E2B] font-medium group-hover:underline">View</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

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

export default function AccountAdminDetailPage() {
  return (
    <RequirePermission resource="accounts" action="view">
      <AccountAdminDetail />
    </RequirePermission>
  );
}

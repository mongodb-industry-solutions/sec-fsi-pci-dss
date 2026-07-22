'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Eye, ShieldAlert, Check } from 'lucide-react';
import { Pagination } from '../../../../../components/Pagination';
import { api, type AdminPayoutAccount } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify, useConfirm } from '../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../lib/permissions';
import { ModalShell, Field, ModalActions } from './AdminModal';

// v29 SD-66 global payout-account administration panel (built-in account-information module). Rendered
// as the "Accounts" tab of the account-information module page. QE/GDPR: IBAN/routing are never returned
// here (presence hints only); the raw IBAN reveal stays on its dedicated party-scoped route.
// PCI DSS Req 7, Req 10. Receives 409 managed_externally → static banner.

const STATUSES = ['active', 'pending_validation', 'suspended', 'closed'] as const;
const TYPES = ['bank_account', 'wallet', 'internal_ledger'] as const;
const RAILS = ['sepa', 'ach', 'swift', 'local_bank', 'internal_wallet', 'internal_ledger'] as const;

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'active' ? 'bg-green-100 text-green-800'
      : status === 'pending_validation' ? 'bg-blue-100 text-blue-800'
      : status === 'suspended' ? 'bg-yellow-100 text-yellow-800'
      : status === 'closed' ? 'bg-red-100 text-red-800'
      : 'bg-gray-100 text-gray-700';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>;
}

export function AccountsAdminPanel() {
  const token = getToken() ?? '';
  const notify = useNotify();
  const confirm = useConfirm();
  // accounts:view reaches this tab, but POST/PATCH/DELETE require accounts:manage (e.g. security_auditor
  // is view-only). Hide mutation controls for view-only roles instead of surfacing guaranteed 403s.
  const { can } = useEffectivePermissions();
  const canManage = can('accounts', 'manage');
  const router = useRouter();

  const [rows, setRows] = useState<AdminPayoutAccount[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [managedExternally, setManagedExternally] = useState(false);

  const [status, setStatus] = useState('');
  const [party, setParty] = useState('');
  const [currency, setCurrency] = useState('');

  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await api.modules.accountAdmin.list(
        { page, limit, status: status || undefined, party: party || undefined, currency: currency || undefined },
        token,
      );
      setRows(r.results);
      setTotal(r.total);
      setManagedExternally(false);
    } catch (e) {
      if (e instanceof Error && e.message === 'managed_externally') setManagedExternally(true);
      else notify(e instanceof Error ? e.message : 'Could not load accounts', 'error');
      setRows([]); setTotal(0);
    } finally { setLoading(false); }
  }, [token, page, limit, status, party, currency, notify]);

  useEffect(() => { load(); }, [load]);

  async function close(a: AdminPayoutAccount) {
    const ok = await confirm({
      title: 'Close account?',
      message: `Payout account ${a.payoutAccountAlias ?? a.payoutAccountInstanceReference} will be closed (soft-close; retained for audit).`,
      confirmLabel: 'Close account',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.modules.accountAdmin.close(a.payoutAccountInstanceReference, token);
      notify('Account closed', 'success');
      load();
    } catch (e) { notify(e instanceof Error ? e.message : 'Close failed', 'error'); }
  }

  function openDetail(a: AdminPayoutAccount) {
    router.push(`/system/admin/modules/account-information/accounts/${encodeURIComponent(a.payoutAccountInstanceReference)}`);
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (managedExternally) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3 text-sm text-amber-800">
        <ShieldAlert size={18} className="text-amber-600 mt-0.5 shrink-0" />
        <p>This capability is managed by an external provider; built-in administration is disabled.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        {canManage && (
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm">
          <Plus size={15} /> Create account
        </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}
            className="border rounded-lg px-3 py-1.5 text-sm">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
          <input value={currency} onChange={(e) => { setPage(1); setCurrency(e.target.value.toUpperCase()); }}
            placeholder="EUR" maxLength={3} className="w-24 border rounded-lg px-3 py-1.5 text-sm font-mono" />
        </div>
        <div className="grow min-w-[220px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Party reference</label>
          <input value={party} onChange={(e) => { setPage(1); setParty(e.target.value); }}
            placeholder="partyInstanceReference" className="w-full border rounded-lg px-3 py-1.5 text-sm font-mono" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase border-b bg-gray-50">
                <th className="py-2.5 px-4 font-medium">Alias / Bank</th>
                <th className="py-2.5 px-4 font-medium">Type</th>
                <th className="py-2.5 px-4 font-medium">Currency</th>
                <th className="py-2.5 px-4 font-medium">Status</th>
                <th className="py-2.5 px-4 font-medium">IBAN</th>
                <th className="py-2.5 px-4 font-medium">Party</th>
                <th className="py-2.5 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">No accounts</td></tr>
              ) : rows.map((a) => (
                <tr key={a.payoutAccountInstanceReference} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2.5 px-4">{a.payoutAccountAlias ?? a.payoutAccountBankName ?? '—'}</td>
                  <td className="py-2.5 px-4">{a.payoutAccountType}</td>
                  <td className="py-2.5 px-4 font-mono">{a.payoutAccountCurrency}</td>
                  <td className="py-2.5 px-4"><StatusBadge status={a.payoutAccountStatus} /></td>
                  <td className="py-2.5 px-4">{a.payoutAccountHasIban ? <Check size={15} className="text-green-600" /> : <span className="text-gray-300">—</span>}</td>
                  <td className="py-2.5 px-4 font-mono text-xs text-gray-500 truncate max-w-[160px]" title={a.partyInstanceReference}>{a.partyInstanceReference}</td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => openDetail(a)} title="View detail" className="p-1.5 rounded text-gray-400 hover:text-[#001E2B] hover:bg-gray-100 transition-colors"><Eye size={15} /></button>
                      {canManage && <button onClick={() => close(a)} title="Close account" className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-gray-100 transition-colors"><Trash2 size={15} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="px-4 border-t">
            <Pagination page={page} totalPages={totalPages} total={total} limit={limit}
              onPageChange={setPage} onLimitChange={(l) => { setLimit(l); setPage(1); }} noun="accounts" />
          </div>
        )}
      </div>

      {showCreate && <CreateAccountModal token={token} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} notify={notify} />}
    </div>
  );
}

function CreateAccountModal({ token, onClose, onCreated, notify }: {
  token: string; onClose: () => void; onCreated: () => void; notify: (m: string, t: 'success' | 'error') => void;
}) {
  const [form, setForm] = useState({
    partyInstanceReference: '',
    payoutAccountType: 'bank_account' as (typeof TYPES)[number],
    payoutAccountCurrency: 'EUR',
    payoutAccountCountryCode: '',
    payoutAccountPreferredRail: 'sepa' as (typeof RAILS)[number],
    payoutAccountAlias: '',
    payoutAccountBankName: '',
    payoutAccountHolderName: '',
    payoutAccountBicSwift: '',
    payoutAccountIban: '',
    payoutAccountRoutingNumber: '',
  });
  const [saving, setSaving] = useState(false);
  const valid = form.partyInstanceReference.trim() && form.payoutAccountCurrency.trim() && form.payoutAccountCountryCode.trim();

  async function submit() {
    if (!valid) { notify('Party, currency and country code are required', 'error'); return; }
    setSaving(true);
    try {
      await api.modules.accountAdmin.create({
        partyInstanceReference: form.partyInstanceReference.trim(),
        payoutAccountType: form.payoutAccountType,
        payoutAccountCurrency: form.payoutAccountCurrency.trim().toUpperCase(),
        payoutAccountCountryCode: form.payoutAccountCountryCode.trim().toUpperCase(),
        payoutAccountPreferredRail: form.payoutAccountPreferredRail,
        ...(form.payoutAccountAlias.trim() ? { payoutAccountAlias: form.payoutAccountAlias.trim() } : {}),
        ...(form.payoutAccountBankName.trim() ? { payoutAccountBankName: form.payoutAccountBankName.trim() } : {}),
        ...(form.payoutAccountHolderName.trim() ? { payoutAccountHolderName: form.payoutAccountHolderName.trim() } : {}),
        ...(form.payoutAccountBicSwift.trim() ? { payoutAccountBicSwift: form.payoutAccountBicSwift.trim() } : {}),
        ...(form.payoutAccountIban.trim() ? { payoutAccountIban: form.payoutAccountIban.trim() } : {}),
        ...(form.payoutAccountRoutingNumber.trim() ? { payoutAccountRoutingNumber: form.payoutAccountRoutingNumber.trim() } : {}),
      }, token);
      notify('Account created', 'success');
      onCreated();
    } catch (e) {
      if (e instanceof Error && e.message === 'managed_externally') notify('Capability managed by an external provider', 'error');
      else notify(e instanceof Error ? e.message : 'Creation failed', 'error');
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title="Create payout account" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Party reference *">
          <input value={form.partyInstanceReference} onChange={(e) => setForm({ ...form, partyInstanceReference: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="partyInstanceReference" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select value={form.payoutAccountType} onChange={(e) => setForm({ ...form, payoutAccountType: e.target.value as (typeof TYPES)[number] })}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Preferred rail">
            <select value={form.payoutAccountPreferredRail} onChange={(e) => setForm({ ...form, payoutAccountPreferredRail: e.target.value as (typeof RAILS)[number] })}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              {RAILS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Currency *">
            <input value={form.payoutAccountCurrency} onChange={(e) => setForm({ ...form, payoutAccountCurrency: e.target.value.toUpperCase() })}
              maxLength={3} className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="EUR" />
          </Field>
          <Field label="Country code *">
            <input value={form.payoutAccountCountryCode} onChange={(e) => setForm({ ...form, payoutAccountCountryCode: e.target.value.toUpperCase() })}
              maxLength={2} className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="ES" />
          </Field>
        </div>
        <Field label="Alias (optional)">
          <input value={form.payoutAccountAlias} onChange={(e) => setForm({ ...form, payoutAccountAlias: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Main payout" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bank name (optional)">
            <input value={form.payoutAccountBankName} onChange={(e) => setForm({ ...form, payoutAccountBankName: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </Field>
          <Field label="Holder name (optional)">
            <input value={form.payoutAccountHolderName} onChange={(e) => setForm({ ...form, payoutAccountHolderName: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
          </Field>
          <Field label="BIC / SWIFT (optional)">
            <input value={form.payoutAccountBicSwift} onChange={(e) => setForm({ ...form, payoutAccountBicSwift: e.target.value.toUpperCase() })}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
          </Field>
          <Field label="Routing number (optional)">
            <input value={form.payoutAccountRoutingNumber} onChange={(e) => setForm({ ...form, payoutAccountRoutingNumber: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
          </Field>
        </div>
        <Field label="IBAN (optional, encrypted at rest)">
          <input value={form.payoutAccountIban} onChange={(e) => setForm({ ...form, payoutAccountIban: e.target.value.toUpperCase() })}
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="ESxx ..." />
        </Field>
        <p className="text-xs text-gray-400">IBAN and routing number are QE-encrypted at rest and never returned by this admin surface (presence hints only).</p>
      </div>
      <ModalActions onClose={onClose} onConfirm={submit} confirmLabel={saving ? 'Saving…' : 'Create'} disabled={saving || !valid} />
    </ModalShell>
  );
}


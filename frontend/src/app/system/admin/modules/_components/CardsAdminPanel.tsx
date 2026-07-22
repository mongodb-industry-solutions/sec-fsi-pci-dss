'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Power, Eye, ShieldAlert, Search, X } from 'lucide-react';
import { Pagination } from '../../../../../components/Pagination';
import { api, type AdminCard, type AdminPayoutAccount, type PartyOwnerResult } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify, useConfirm } from '../../../../../components/ui/ConfirmProvider';
import { useEffectivePermissions } from '../../../../../lib/permissions';
import { ModalShell, Field, ModalActions } from './AdminModal';

// v29 SD-88 global card administration panel (built-in card-issuer module). Rendered as the "Cards"
// tab of the card-issuer module page. Display-safe only: masked PAN, surrogate token, network, status.
// Full PAN / CVV / PIN are never accepted or shown; expiry only in per-card detail (need-to-know).
// PCI DSS Req 3.2/3.3, Req 7, Req 10. Receives 409 managed_externally → static banner.

const NETWORKS = ['VISA', 'MASTERCARD', 'AMEX', 'ELO'] as const;
const STATUSES = ['issued', 'active', 'pending_activation', 'blocked', 'suspended', 'revoked', 'expired'] as const;
// The backend activation toggle only supports active <-> suspended. Every other status
// (issued, pending_activation, blocked, revoked, expired) is NOT toggleable from here.
const TOGGLEABLE_STATES = ['active', 'suspended'];

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'active' || status === 'issued' ? 'bg-green-100 text-green-800'
      : status === 'suspended' || status === 'blocked' ? 'bg-yellow-100 text-yellow-800'
      : status === 'revoked' || status === 'expired' ? 'bg-red-100 text-red-800'
      : 'bg-gray-100 text-gray-700';
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{status}</span>;
}

export function CardsAdminPanel() {
  const token = getToken() ?? '';
  const notify = useNotify();
  const confirm = useConfirm();
  const router = useRouter();
  // cards:view reaches this tab, but POST/PATCH/DELETE require cards:manage (e.g. security_auditor is
  // view-only). Hide mutation controls for view-only roles instead of surfacing guaranteed 403s.
  const { can } = useEffectivePermissions();
  const canManage = can('cards', 'manage');

  const [rows, setRows] = useState<AdminCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [managedExternally, setManagedExternally] = useState(false);

  const [network, setNetwork] = useState('');
  const [status, setStatus] = useState('');
  const [agreement, setAgreement] = useState('');
  const [last4, setLast4] = useState('');
  const [bin, setBin] = useState('');

  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await api.modules.cardAdmin.list(
        { page, limit, network: network || undefined, status: status || undefined, agreement: agreement || undefined, last4: last4 || undefined, bin: bin || undefined },
        token,
      );
      setRows(r.results);
      setTotal(r.total);
      setManagedExternally(false);
    } catch (e) {
      if (e instanceof Error && e.message === 'managed_externally') setManagedExternally(true);
      else notify(e instanceof Error ? e.message : 'Could not load cards', 'error');
      setRows([]); setTotal(0);
    } finally { setLoading(false); }
  }, [token, page, limit, network, status, agreement, last4, bin, notify]);

  useEffect(() => { load(); }, [load]);

  async function toggleStatus(c: AdminCard) {
    if (!TOGGLEABLE_STATES.includes(c.paymentCardStatus)) return;
    const activate = c.paymentCardStatus === 'suspended';
    try {
      await api.modules.cardAdmin.setStatus(c.paymentCardInstanceReference, activate, token);
      notify(activate ? 'Card activated' : 'Card suspended', 'success');
      load();
    } catch (e) { notify(e instanceof Error ? e.message : 'Status change failed', 'error'); }
  }

  async function revoke(c: AdminCard) {
    const ok = await confirm({
      title: 'Revoke card?',
      message: `Card ${c.paymentCardMaskedPanDisplay} will be revoked (soft-delete; retained for audit).`,
      confirmLabel: 'Revoke card',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.modules.cardAdmin.revoke(c.paymentCardInstanceReference, token);
      notify('Card revoked', 'success');
      load();
    } catch (e) { notify(e instanceof Error ? e.message : 'Revoke failed', 'error'); }
  }

  function openDetail(c: AdminCard) {
    router.push(`/system/admin/modules/card-issuer/cards/${encodeURIComponent(c.paymentCardInstanceReference)}`);
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
          <Plus size={15} /> Register card
        </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Network</label>
          <select value={network} onChange={(e) => { setPage(1); setNetwork(e.target.value); }}
            className="border rounded-lg px-3 py-1.5 text-sm">
            <option value="">All</option>
            {NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}
            className="border rounded-lg px-3 py-1.5 text-sm">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">BIN</label>
          <input value={bin} onChange={(e) => { setPage(1); setBin(e.target.value.replace(/\D/g, '').slice(0, 8)); }}
            placeholder="e.g. 411111" inputMode="numeric"
            className="w-28 border rounded-lg px-3 py-1.5 text-sm font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Last 4</label>
          <input value={last4} onChange={(e) => { setPage(1); setLast4(e.target.value.replace(/\D/g, '').slice(0, 4)); }}
            placeholder="1234" inputMode="numeric"
            className="w-20 border rounded-lg px-3 py-1.5 text-sm font-mono" />
        </div>
        <div className="grow min-w-[220px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">Agreement reference</label>
          <input value={agreement} onChange={(e) => { setPage(1); setAgreement(e.target.value); }}
            placeholder="customerAgreementInstanceReference"
            className="w-full border rounded-lg px-3 py-1.5 text-sm font-mono" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
                <th className="py-2.5 px-4 font-medium">Agreement</th>
                <th className="py-2.5 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">No cards</td></tr>
              ) : rows.map((c) => (
                <tr key={c.paymentCardInstanceReference} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2.5 px-4 font-mono">{c.paymentCardMaskedPanDisplay}</td>
                  <td className="py-2.5 px-4 font-mono text-xs text-gray-500">{c.paymentCardBin ?? '—'}</td>
                  <td className="py-2.5 px-4 font-mono text-xs text-gray-500">{c.paymentCardLast4 ?? '—'}</td>
                  <td className="py-2.5 px-4">{c.paymentCardNetwork ?? '—'}</td>
                  <td className="py-2.5 px-4"><StatusBadge status={c.paymentCardStatus} /></td>
                  <td className="py-2.5 px-4">{c.paymentCardAlias ?? '—'}</td>
                  <td className="py-2.5 px-4 font-mono text-xs text-gray-500 truncate max-w-[180px]" title={c.customerAgreementInstanceReference}>{c.customerAgreementInstanceReference}</td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => openDetail(c)} title="View detail" className="p-1.5 rounded text-gray-400 hover:text-[#001E2B] hover:bg-gray-100 transition-colors"><Eye size={15} /></button>
                      {canManage && <button onClick={() => toggleStatus(c)} disabled={!TOGGLEABLE_STATES.includes(c.paymentCardStatus)} title={TOGGLEABLE_STATES.includes(c.paymentCardStatus) ? (c.paymentCardStatus === 'active' ? 'Suspend' : 'Activate') : 'Status not toggleable'} className="p-1.5 rounded text-gray-400 hover:text-yellow-600 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent"><Power size={15} /></button>}
                      {canManage && <button onClick={() => revoke(c)} title="Revoke" className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-gray-100 transition-colors"><Trash2 size={15} /></button>}
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
              onPageChange={setPage} onLimitChange={(l) => { setLimit(l); setPage(1); }} noun="cards" />
          </div>
        )}
      </div>

      {showCreate && <CreateCardModal token={token} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} notify={notify} />}
    </div>
  );
}

function CreateCardModal({ token, onClose, onCreated, notify }: {
  token: string; onClose: () => void; onCreated: () => void; notify: (m: string, t: 'success' | 'error') => void;
}) {
  const [form, setForm] = useState({
    cardToken: '',
    paymentCardMaskedPanDisplay: '',
    paymentCardNetwork: 'VISA' as (typeof NETWORKS)[number],
    paymentCardExpirationDate: '',
    paymentCardAlias: '',
  });
  const [saving, setSaving] = useState(false);
  // v30.2 funding picker: search the owner by name (party) then pick one of their payout accounts.
  // The chosen funding account is required; the cardholder (agreement) is derived server-side.
  const [party, setParty] = useState<PartyOwnerResult | null>(null);
  const [funding, setFunding] = useState<AdminPayoutAccount | null>(null);
  const valid = !!funding && form.cardToken.trim();

  function clearParty() {
    setParty(null);
    setFunding(null);
  }

  async function submit() {
    if (!valid || !funding) { notify('A funding account and card token are required', 'error'); return; }
    setSaving(true);
    try {
      await api.modules.cardAdmin.register({
        fundingPayoutAccountInstanceReference: funding.payoutAccountInstanceReference,
        cardToken: form.cardToken.trim(),
        ...(form.paymentCardMaskedPanDisplay.trim() ? { paymentCardMaskedPanDisplay: form.paymentCardMaskedPanDisplay.trim() } : {}),
        paymentCardNetwork: form.paymentCardNetwork,
        ...(form.paymentCardExpirationDate.trim() ? { paymentCardExpirationDate: form.paymentCardExpirationDate.trim() } : {}),
        ...(form.paymentCardAlias.trim() ? { paymentCardAlias: form.paymentCardAlias.trim() } : {}),
      }, token);
      notify('Card registered', 'success');
      onCreated();
    } catch (e) {
      if (e instanceof Error && e.message === 'managed_externally') notify('Capability managed by an external provider', 'error');
      else notify(e instanceof Error ? e.message : 'Registration failed', 'error');
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title="Register card" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Funding account *">
          {party && funding ? (
            <div className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-sm bg-gray-50">
              <span className="min-w-0">
                <span className="text-gray-800 font-medium truncate">{party.ownerName ?? 'Unnamed owner'}</span>
                <span className="block text-xs text-gray-500 truncate">
                  {funding.payoutAccountAlias ?? funding.payoutAccountBankName ?? 'Payout account'}
                  {funding.payoutAccountCurrency ? ` · ${funding.payoutAccountCurrency}` : ''}
                </span>
                <span className="block text-xs text-gray-400 font-mono truncate">{funding.payoutAccountInstanceReference}</span>
              </span>
              <button type="button" onClick={clearParty} title="Change funding account"
                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-gray-100 transition-colors shrink-0"><X size={15} /></button>
            </div>
          ) : party ? (
            <FundingAccountPicker token={token} party={party} onPick={setFunding} onBack={() => setParty(null)} notify={notify} />
          ) : (
            <OwnerSearch token={token} onPick={setParty} notify={notify} />
          )}
          <p className="mt-1 text-xs text-gray-400">The cardholder (owner) is derived from the funding account server-side.</p>
        </Field>
        <Field label="Card token (PAN surrogate) *">
          <input value={form.cardToken} onChange={(e) => setForm({ ...form, cardToken: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="tok_..." />
        </Field>
        <Field label="Masked PAN (optional)">
          <input value={form.paymentCardMaskedPanDisplay} onChange={(e) => setForm({ ...form, paymentCardMaskedPanDisplay: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="****-****-****-1234" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Network">
            <select value={form.paymentCardNetwork} onChange={(e) => setForm({ ...form, paymentCardNetwork: e.target.value as (typeof NETWORKS)[number] })}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              {NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Expiry (MM/YY, optional)">
            <input value={form.paymentCardExpirationDate} onChange={(e) => setForm({ ...form, paymentCardExpirationDate: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="12/28" />
          </Field>
        </div>
        <Field label="Alias (optional)">
          <input value={form.paymentCardAlias} onChange={(e) => setForm({ ...form, paymentCardAlias: e.target.value })}
            maxLength={40} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Corporate travel card" />
        </Field>
        <p className="text-xs text-gray-400">CVV and PIN are never accepted or stored (PCI DSS Req 3.2). PAN is display-safe (masked) only.</p>
      </div>
      <ModalActions onClose={onClose} onConfirm={submit} confirmLabel={saving ? 'Saving…' : 'Register'} disabled={saving || !valid} />
    </ModalShell>
  );
}

// Debounced owner search box: queries parties by owner name; picking a result advances to the
// funding-account picker for that party.
function OwnerSearch({ token, onPick, notify }: {
  token: string;
  onPick: (r: PartyOwnerResult) => void;
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
          if (e instanceof Error && e.message === 'managed_externally') notify('Capability managed by an external provider', 'error');
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
        <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
          className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm" placeholder="Search owner by name" />
      </div>
      {searching && <p className="text-xs text-gray-400">Searching…</p>}
      {results.length > 0 && (
        <ul className="border rounded-lg divide-y max-h-48 overflow-y-auto">
          {results.map((r) => (
            <li key={r.partyInstanceReference}>
              <button type="button" onClick={() => onPick(r)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
                <span className="text-gray-800 font-medium">{r.ownerName ?? 'Unnamed owner'}</span>
                <span className="block text-xs text-gray-400 font-mono truncate">{r.partyInstanceReference}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searched && !searching && results.length === 0 && (
        <p className="text-xs text-gray-400">No matching owner.</p>
      )}
    </div>
  );
}

// Loads the selected party's payout accounts and lets the user pick the card's funding account.
function FundingAccountPicker({ token, party, onPick, onBack, notify }: {
  token: string;
  party: PartyOwnerResult;
  onPick: (a: AdminPayoutAccount) => void;
  onBack: () => void;
  notify: (m: string, t: 'success' | 'error') => void;
}) {
  const [accounts, setAccounts] = useState<AdminPayoutAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.modules.accountAdmin.list({ party: party.partyInstanceReference, limit: 50 }, token)
      .then((r) => { if (!cancelled) setAccounts(r.results); })
      .catch((e) => {
        if (!cancelled) {
          setAccounts([]);
          if (e instanceof Error && e.message === 'managed_externally') notify('Capability managed by an external provider', 'error');
          else notify(e instanceof Error ? e.message : 'Could not load payout accounts', 'error');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, party.partyInstanceReference, notify]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500 truncate">Owner: <span className="text-gray-800 font-medium">{party.ownerName ?? 'Unnamed owner'}</span></span>
        <button type="button" onClick={onBack} className="text-xs text-[#001E2B] hover:underline shrink-0">Change owner</button>
      </div>
      {loading ? (
        <p className="text-xs text-gray-400">Loading payout accounts…</p>
      ) : accounts.length === 0 ? (
        <p className="text-xs text-gray-400">This owner has no payout accounts.</p>
      ) : (
        <ul className="border rounded-lg divide-y max-h-48 overflow-y-auto">
          {accounts.map((a) => (
            <li key={a.payoutAccountInstanceReference}>
              <button type="button" onClick={() => onPick(a)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
                <span className="text-gray-800 font-medium">
                  {a.payoutAccountAlias ?? a.payoutAccountBankName ?? 'Payout account'}
                  {a.payoutAccountCurrency ? ` · ${a.payoutAccountCurrency}` : ''}
                </span>
                <span className="block text-xs text-gray-400 font-mono truncate">{a.payoutAccountInstanceReference}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


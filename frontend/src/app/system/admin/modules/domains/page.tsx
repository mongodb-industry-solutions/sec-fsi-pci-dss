'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { KeyRound, Plus, Pencil, Trash2, Check, X, ChevronRight } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { Pagination } from '../../../../../components/Pagination';
import { api } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { useNotify } from '../../../../../components/ui/ConfirmProvider';

type Row = Record<string, unknown>;
const PAGE_SIZE = 10;
const TYPES = ['local', 'oidc', 'saml'];

interface FormState {
  partyAuthenticationDomainInstanceReference?: string;
  partyAuthenticationDomainName: string;
  partyAuthenticationDomainDisplayName: string;
  partyAuthenticationDomainType: string;
  partyAuthenticationDomainEnabled: boolean;
}
const EMPTY: FormState = {
  partyAuthenticationDomainName: '',
  partyAuthenticationDomainDisplayName: '',
  partyAuthenticationDomainType: 'local',
  partyAuthenticationDomainEnabled: true,
};

export default function AuthDomainsPage() {
  const token = getToken() ?? '';
  const notify = useNotify();

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<FormState | null>(null); // null = form hidden
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState(''); // standard list filter

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.modules.domains.list(token, { q, page, limit: PAGE_SIZE });
      setRows(d.items ?? []);
      setTotal(d.total ?? 0);
    } catch {
      setRows([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token, q, page]);

  useEffect(() => { load(); }, [load]);

  function startCreate() { setForm({ ...EMPTY }); }
  function startEdit(r: Row) {
    setForm({
      partyAuthenticationDomainInstanceReference: String(r.partyAuthenticationDomainInstanceReference),
      partyAuthenticationDomainName: String(r.partyAuthenticationDomainName ?? ''),
      partyAuthenticationDomainDisplayName: String(r.partyAuthenticationDomainDisplayName ?? ''),
      partyAuthenticationDomainType: String(r.partyAuthenticationDomainType ?? 'local'),
      partyAuthenticationDomainEnabled: Boolean(r.partyAuthenticationDomainEnabled),
    });
  }

  async function submit() {
    if (!form) return;
    setSaving(true);
    try {
      if (form.partyAuthenticationDomainInstanceReference) {
        const { partyAuthenticationDomainInstanceReference: id, ...rest } = form;
        await api.modules.domains.update(id, rest as Record<string, unknown>, token);
        notify('Authentication domain updated', 'success');
      } else {
        await api.modules.domains.create(form as unknown as Record<string, unknown>, token);
        notify('Authentication domain created', 'success');
      }
      setForm(null);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.modules.domains.remove(id, token);
      notify('Authentication domain deleted', 'success');
      setConfirmingId(null);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Type filter is applied client-side over the current page (domain set is small); search +
  // pagination remain server-side via the API.
  const shown = typeFilter ? rows.filter((r) => String(r.partyAuthenticationDomainType) === typeFilter) : rows;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <Breadcrumb items={[{ label: 'Home', href: '/system' }, { label: 'Modules', href: '/system/admin/modules' }, { label: 'Auth Domains' }]} />
      <SectionHeader
        icon={KeyRound}
        title="Auth Domains"
        description="Authentication-domain registry; internal module (full CRUD). Domains drive the login UI."
        debugInfo="BIAN SD-16 · collection authenticationDomain · /api/v1/modules/domains"
        actions={
          <button onClick={startCreate} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium">
            <Plus size={14} /> New domain
          </button>
        }
      />

      {/* Search + type filter; standard pattern (input + filter + Search + Clear) */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); setQ(qInput.trim()); } }}
          placeholder="Search by name or display…"
          className="flex-1 min-w-[200px] border rounded-lg px-3 py-2 text-sm"
        />
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          onClick={() => { setPage(1); setQ(qInput.trim()); }}
          className="px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold"
        >
          Search
        </button>
        {(q || qInput || typeFilter) && (
          <button
            onClick={() => { setQInput(''); setQ(''); setTypeFilter(''); setPage(1); }}
            className="px-3 py-2 rounded-lg border text-sm text-gray-500 hover:bg-gray-50 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Create/edit form */}
      {form && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="font-semibold text-gray-800 text-sm">{form.partyAuthenticationDomainInstanceReference ? 'Edit' : 'New'} authentication domain</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name (slug)</label>
              <input value={form.partyAuthenticationDomainName} onChange={(e) => setForm({ ...form, partyAuthenticationDomainName: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Display name</label>
              <input value={form.partyAuthenticationDomainDisplayName} onChange={(e) => setForm({ ...form, partyAuthenticationDomainDisplayName: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={form.partyAuthenticationDomainType} onChange={(e) => setForm({ ...form, partyAuthenticationDomainType: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm mt-6">
              <input type="checkbox" checked={form.partyAuthenticationDomainEnabled} onChange={(e) => setForm({ ...form, partyAuthenticationDomainEnabled: e.target.checked })} />
              Enabled
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={submit} disabled={saving || !form.partyAuthenticationDomainName}
              className="flex items-center gap-1.5 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg disabled:opacity-60 text-sm">
              <Check size={15} />{saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setForm(null)} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Display</th>
              <th className="text-left px-4 py-2 font-medium">Type</th>
              <th className="text-left px-4 py-2 font-medium">Enabled</th>
              <th className="text-right px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No authentication domains{typeFilter ? ` of type "${typeFilter}"` : ''}.</td></tr>
            ) : shown.map((r) => {
              const id = String(r.partyAuthenticationDomainInstanceReference);
              const detailHref = `/system/admin/modules/domains/${id}`;
              return (
                <tr key={id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={detailHref} className="text-[#001E2B] hover:underline">{String(r.partyAuthenticationDomainName)}</Link>
                  </td>
                  <td className="px-4 py-2">{String(r.partyAuthenticationDomainDisplayName ?? '')}</td>
                  <td className="px-4 py-2">{String(r.partyAuthenticationDomainType ?? '')}</td>
                  <td className="px-4 py-2">{r.partyAuthenticationDomainEnabled ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      {confirmingId === id ? (
                        <>
                          <button onClick={() => remove(id)} className="text-red-600 hover:text-red-800 flex items-center gap-1 text-xs"><Check size={13} /> Confirm</button>
                          <button onClick={() => setConfirmingId(null)} className="text-gray-400 hover:text-gray-700"><X size={13} /></button>
                        </>
                      ) : (
                        <>
                          <Link href={detailHref}
                            title={String(r.partyAuthenticationDomainType) === 'local' ? 'Manage users & access' : 'Manage role mappings & access'}
                            className="inline-flex items-center gap-1 text-xs text-[#001E2B] hover:underline">
                            Manage <ChevronRight size={13} />
                          </Link>
                          <button onClick={() => startEdit(r)} title="Quick edit" className="text-gray-500 hover:text-[#001E2B]"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmingId(id)} title="Delete" className="text-gray-500 hover:text-red-600"><Trash2 size={14} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} limit={PAGE_SIZE} onPageChange={setPage} noun="domains" />
    </div>
  );
}

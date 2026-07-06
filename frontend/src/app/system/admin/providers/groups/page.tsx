'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Network, Plus, Trash2, Users, Search, Star, ChevronDown, ChevronRight, Power, Filter, X } from 'lucide-react';
import { api } from '../../../../../lib/api';
import { getToken, decodeToken } from '../../../../../lib/auth';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Pagination } from '../../../../../components/Pagination';
import { useConfirm, useNotify } from '../../../../../components/ui/ConfirmProvider';
import { byProviderType, CAPABILITY_LIST } from '../../../../../config/capabilities';

// Map a routing group's provider type to its capability admin page (clicking a group card opens it).
function capabilityHref(providerType: string): string | null {
  const cap = byProviderType(providerType)?.capability;
  return cap && cap !== 'generic' ? `/system/admin/providers/${cap}` : null;
}

// Derived from capabilities.ts — single source of truth; no manual sync needed.
const PROVIDER_TYPES = CAPABILITY_LIST.map((c) => c.providerType);
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CAPABILITY_LIST.map((c) => [c.providerType, c.label])
);

interface Member {
  externalProviderArrangementInstanceReference: string;
  externalProviderArrangementName?: string;
  memberPriority?: number;
  memberRole?: string;
}
interface RoutingGroup {
  routingGroupInstanceReference: string;
  routingGroupName: string;
  routingGroupProviderType: string;
  routingGroupStrategy: string;
  routingGroupStatus: string;
  routingGroupMembers: Member[];
  isDefaultGroup?: boolean;
}
interface Provider {
  externalProviderArrangementInstanceReference: string;
  externalProviderArrangementName: string;
  externalProviderArrangementType: string;
  externalProviderArrangementStatus?: string;
}

const STRATEGIES = ['primary_fallback', 'round_robin', 'weighted', 'parallel'];
const STRATEGY_LABEL: Record<string, string> = {
  primary_fallback: 'Primary / Fallback', round_robin: 'Round Robin', weighted: 'Weighted', parallel: 'Parallel',
};
const PAGE_SIZE = 9;

export default function RoutingGroupsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useNotify();
  const [token, setToken] = useState('');
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const [groups, setGroups] = useState<RoutingGroup[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('fraud_detection');
  const [newStrategy, setNewStrategy] = useState('primary_fallback');
  const [creating, setCreating] = useState(false);

  // Filters
  const [nameInput, setNameInput]   = useState('');
  const [search, setSearch]         = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState(PAGE_SIZE);
  const [busy, setBusy]             = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null); // custom-group member/strategy editor

  useEffect(() => {
    const t = getToken() ?? '';
    const role = t ? decodeToken(t)?.role : null;
    setToken(t);
    if (role !== 'manager') { setAuthorized(false); router.replace('/system'); return; }
    setAuthorized(true);
  }, [router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [g, p] = await Promise.all([
        api.integrationGroups.list(token),
        api.integrations.list(token),
      ]);
      setGroups(g.groups as unknown as RoutingGroup[]);
      setProviders(p.integrations as unknown as Provider[]);
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [token, notify]);

  useEffect(() => { if (authorized) load(); }, [authorized, load]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.integrationGroups.create({ name: newName.trim(), providerType: newType, strategy: newStrategy }, token);
      setNewName('');
      notify('Routing group created.', 'success');
      load();
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setCreating(false); }
  }

  async function handleDelete(g: RoutingGroup) {
    const ok = await confirm({
      title: `Delete "${g.routingGroupName}"?`,
      message: 'Members will be detached from this group. This cannot be undone.',
      confirmLabel: 'Delete group',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(g.routingGroupInstanceReference);
    try {
      await api.integrationGroups.deleteGroup(g.routingGroupInstanceReference, token);
      notify('Routing group deleted.', 'success');
      load();
    } catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }

  async function handleStrategy(g: RoutingGroup, strategy: string) {
    setBusy(g.routingGroupInstanceReference);
    try { await api.integrationGroups.update(g.routingGroupInstanceReference, { routingGroupStrategy: strategy }, token); load(); }
    catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }

  async function handleStatus(g: RoutingGroup) {
    const next = g.routingGroupStatus === 'active' ? 'inactive' : 'active';
    setBusy(g.routingGroupInstanceReference);
    try { await api.integrationGroups.update(g.routingGroupInstanceReference, { routingGroupStatus: next }, token); load(); }
    catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }

  async function handleAddMember(g: RoutingGroup, providerId: string) {
    if (!providerId) return;
    setBusy(g.routingGroupInstanceReference);
    try { await api.integrationGroups.addMember(g.routingGroupInstanceReference, { providerId }, token); load(); }
    catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }

  async function handleRemoveMember(g: RoutingGroup, providerId: string) {
    const ok = await confirm({
      title: 'Remove member?',
      message: 'This provider will stop receiving routed traffic from the group.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(g.routingGroupInstanceReference);
    try { await api.integrationGroups.removeMember(g.routingGroupInstanceReference, providerId, token); load(); }
    catch (err) { notify((err as Error).message, 'error'); }
    finally { setBusy(null); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (typeFilter && g.routingGroupProviderType !== typeFilter) return false;
      if (q && !g.routingGroupName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [groups, search, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const hasFilters = !!search || !!typeFilter;

  function handleSearch() { setSearch(nameInput.trim()); setPage(1); }
  function handleClear()  { setNameInput(''); setSearch(''); setTypeFilter(''); setPage(1); }

  const providerName = (id: string) =>
    providers.find((p) => p.externalProviderArrangementInstanceReference === id)?.externalProviderArrangementName ?? id;

  if (authorized === false) return null;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Network}
        title="Groups"
        description="Provider categories. Built-in groups can be activated/deactivated; add custom groups for advanced routing."
        info="Each built-in group is a provider category (e.g. Fraud Detection). Open one to manage its providers. Built-in groups cannot be deleted; only deactivated. Custom groups add routing across multiple providers (strategy + members)."
        debugInfo="BIAN SD-193 ExternalProviderArrangementPortfolio · built-in deactivate-only · custom = routing strategy + members · manager only"
      />

      {/* Create */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800 text-sm">Create a routing group</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Fraud; primary + fallback"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Provider type</label>
            <select value={newType} onChange={(e) => setNewType(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              {PROVIDER_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Strategy</label>
            <select value={newStrategy} onChange={(e) => setNewStrategy(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              {STRATEGIES.map((s) => <option key={s} value={s}>{STRATEGY_LABEL[s]}</option>)}
            </select>
          </div>
          <button onClick={handleCreate} disabled={creating || !newName.trim()}
            className="inline-flex items-center gap-2 bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50 text-sm">
            <Plus size={15} />{creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>

      {/* Filter + search */}
      <div className="bg-white rounded-xl border p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by group name…"
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={handleSearch}
            disabled={!nameInput.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold disabled:opacity-50"
          >
            <Search size={14} />
            <span className="hidden sm:inline">Search</span>
          </button>
          {hasFilters && (
            <button
              onClick={handleClear}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50"
            >
              <X size={14} />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>
        <div className="flex gap-3 flex-wrap items-center">
          <Filter size={14} className="text-gray-400 shrink-0" />
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All types</option>
            {PROVIDER_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <span className="text-gray-400 text-sm ml-auto">{filtered.length} group{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Groups */}
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm">Loading...</div>
      ) : paginated.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          No routing groups{search || typeFilter ? ' match the current filters.' : ' yet. Create one above.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginated.map((g) => {
              const available = providers.filter(
                (p) => p.externalProviderArrangementType === g.routingGroupProviderType &&
                  !g.routingGroupMembers.some((m) => m.externalProviderArrangementInstanceReference === p.externalProviderArrangementInstanceReference)
              );
              const isBusy = busy === g.routingGroupInstanceReference;
              const builtin = !!g.isDefaultGroup;
              const href = capabilityHref(g.routingGroupProviderType);
              const expanded = expandedId === g.routingGroupInstanceReference;
              const active = g.routingGroupStatus === 'active';
              const typeLabel = TYPE_LABEL[g.routingGroupProviderType] ?? g.routingGroupProviderType;

              return (
                <div key={g.routingGroupInstanceReference} className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
                  {/* Header; built-in cards navigate to the capability's provider page */}
                  {builtin && href ? (
                    <Link href={href} className="group block">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-slate-200 transition-colors"><Network size={20} className="text-slate-600" /></div>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{g.routingGroupStatus}</span>
                      </div>
                      <p className="font-semibold text-gray-900 text-sm group-hover:text-[#001E2B] transition-colors">{typeLabel}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{g.routingGroupName}</p>
                    </Link>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="p-2 bg-slate-100 rounded-lg"><Network size={20} className="text-slate-600" /></div>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{g.routingGroupStatus}</span>
                      </div>
                      <p className="font-semibold text-gray-900 text-sm">{g.routingGroupName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{typeLabel}</p>
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {builtin
                      ? <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium border border-blue-200"><Star size={9} /> Built-in</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium border border-purple-200">Custom</span>}
                    <span className="text-[11px] text-gray-400 flex items-center gap-1"><Users size={11} /> {g.routingGroupMembers.length} member{g.routingGroupMembers.length !== 1 ? 's' : ''}</span>
                  </div>

                  {/* Actions */}
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                    <button onClick={() => handleStatus(g)} disabled={isBusy}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      <Power size={12} /> {active ? 'Deactivate' : 'Activate'}
                    </button>
                    {builtin && href && (
                      <Link href={href} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-[#001E2B]/30 text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors">
                        Open <ChevronRight size={12} />
                      </Link>
                    )}
                    {!builtin && (
                      <>
                        <button onClick={() => setExpandedId(expanded ? null : g.routingGroupInstanceReference)}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                          {expanded ? 'Hide' : 'Manage'} <ChevronDown size={12} className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
                        </button>
                        <button onClick={() => handleDelete(g)} disabled={isBusy}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40">
                          <Trash2 size={12} /> Delete
                        </button>
                      </>
                    )}
                  </div>

                  {/* Custom-group routing management (strategy + members); built-ins are deactivate-only */}
                  {!builtin && expanded && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Routing strategy</label>
                        <select value={g.routingGroupStrategy} disabled={isBusy} onChange={(e) => handleStrategy(g, e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                          {STRATEGIES.map((s) => <option key={s} value={s}>{STRATEGY_LABEL[s]}</option>)}
                        </select>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500"><Users size={12} /> Members</div>
                      {g.routingGroupMembers.length === 0 ? (
                        <p className="text-xs text-gray-400">No members yet.</p>
                      ) : (
                        <ul className="divide-y divide-gray-50">
                          {[...g.routingGroupMembers].sort((a, b) => (a.memberPriority ?? 999) - (b.memberPriority ?? 999)).map((m) => (
                            <li key={m.externalProviderArrangementInstanceReference} className="flex items-center gap-2 py-1.5">
                              <span className="text-xs text-gray-700 truncate">{m.externalProviderArrangementName ?? providerName(m.externalProviderArrangementInstanceReference)}</span>
                              {m.memberRole && <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{m.memberRole}</span>}
                              <button onClick={() => handleRemoveMember(g, m.externalProviderArrangementInstanceReference)} disabled={isBusy}
                                className="ml-auto text-xs text-red-600 hover:underline disabled:opacity-50">Remove</button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {available.length > 0 && (
                        <select defaultValue="" disabled={isBusy}
                          onChange={(e) => { handleAddMember(g, e.target.value); e.currentTarget.value = ''; }}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs bg-white">
                          <option value="" disabled>+ Add a {typeLabel} provider…</option>
                          {available.map((p) => (
                            <option key={p.externalProviderArrangementInstanceReference} value={p.externalProviderArrangementInstanceReference}>
                              {p.externalProviderArrangementName}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4">
            <Pagination
              page={safePage}
              totalPages={totalPages}
              total={filtered.length}
              limit={pageSize}
              onPageChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              onLimitChange={(l) => { setPageSize(l); setPage(1); }}
              limitOptions={[6, 9, 20, 50]}
              noun="groups"
            />
          </div>
        </>
      )}
    </div>
  );
}

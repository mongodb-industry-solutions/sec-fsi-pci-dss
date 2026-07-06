'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Network, Plus, Trash2, Users, Search, Star } from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { SectionHeader } from '../../../../components/SectionHeader';
import { Pagination } from '../../../../components/Pagination';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';
import { useDebugMode } from '../../../../lib/debugMode';

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

const PROVIDER_TYPES = [
  'fraud_detection', 'aml_monitoring', 'kyc_identity', 'kyb_business',
  'hrp_sanctions', 'credit_bureau', 'card_authorization', 'card_issuer', 'generic',
];
const TYPE_LABEL: Record<string, string> = {
  fraud_detection: 'Fraud Detection', aml_monitoring: 'AML Monitoring', kyc_identity: 'KYC / Identity',
  kyb_business: 'KYB / Business', hrp_sanctions: 'HRP / Sanctions', credit_bureau: 'Credit Bureau',
  card_authorization: 'Card Authorization', card_issuer: 'Card Issuer', generic: 'Generic',
};
const STRATEGIES = ['primary_fallback', 'round_robin', 'weighted', 'parallel'];
const STRATEGY_LABEL: Record<string, string> = {
  primary_fallback: 'Primary / Fallback', round_robin: 'Round Robin', weighted: 'Weighted', parallel: 'Parallel',
};
const PAGE_SIZE = 8;

export default function RoutingGroupsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const notify = useNotify();
  const { debugMode } = useDebugMode();
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
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const providerName = (id: string) =>
    providers.find((p) => p.externalProviderArrangementInstanceReference === id)?.externalProviderArrangementName ?? id;

  if (authorized === false) return null;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Network}
        title="Routing Groups"
        description="Create and manage provider routing groups and their members."
        info="Routing groups decide which external provider handles each request per integration type, with strategies such as primary/fallback or round robin. The default group is the fallback target and cannot be deleted."
        debugInfo="BIAN SD-193 ExternalProviderArrangementPortfolio · routing strategy + members · manager only"
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
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by group name…"
            className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
        </div>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">All types</option>
          {PROVIDER_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <span className="text-gray-400 text-sm ml-auto">{filtered.length} group{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Groups */}
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm">Loading...</div>
      ) : paginated.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          No routing groups{search || typeFilter ? ' match the current filters.' : ' yet. Create one above.'}
        </div>
      ) : (
        <div className="space-y-3">
          {paginated.map((g) => {
            const available = providers.filter(
              (p) => p.externalProviderArrangementType === g.routingGroupProviderType &&
                !g.routingGroupMembers.some((m) => m.externalProviderArrangementInstanceReference === p.externalProviderArrangementInstanceReference)
            );
            const isBusy = busy === g.routingGroupInstanceReference;
            return (
              <div key={g.routingGroupInstanceReference} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800 text-sm">{g.routingGroupName}</span>
                      {g.isDefaultGroup && (
                        <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium"><Star size={10} /> Default</span>
                      )}
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${g.routingGroupStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>{g.routingGroupStatus}</span>
                    </div>
                    <span className="text-xs text-gray-400">{TYPE_LABEL[g.routingGroupProviderType] ?? g.routingGroupProviderType}</span>
                  </div>
                  <div className="flex items-center gap-2 ml-auto flex-wrap">
                    <select value={g.routingGroupStrategy} disabled={isBusy} onChange={(e) => handleStrategy(g, e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                      {STRATEGIES.map((s) => <option key={s} value={s}>{STRATEGY_LABEL[s]}</option>)}
                    </select>
                    <button onClick={() => handleStatus(g)} disabled={isBusy}
                      className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      {g.routingGroupStatus === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => handleDelete(g)} disabled={isBusy || g.isDefaultGroup}
                      title={g.isDefaultGroup ? 'The default group cannot be deleted' : 'Delete group'}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>

                {/* Members */}
                <div className="px-5 py-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500"><Users size={12} /> Members ({g.routingGroupMembers.length})</div>
                  {g.routingGroupMembers.length === 0 ? (
                    <p className="text-xs text-gray-400">No members yet.</p>
                  ) : (
                    <ul className="divide-y divide-gray-50">
                      {[...g.routingGroupMembers].sort((a, b) => (a.memberPriority ?? 999) - (b.memberPriority ?? 999)).map((m) => (
                        <li key={m.externalProviderArrangementInstanceReference} className="flex items-center gap-2 py-1.5">
                          <span className="text-sm text-gray-700 truncate">{m.externalProviderArrangementName ?? providerName(m.externalProviderArrangementInstanceReference)}</span>
                          {m.memberRole && <span className="text-[11px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{m.memberRole}</span>}
                          {debugMode && <span className="text-[10px] font-mono text-gray-400">prio {m.memberPriority ?? '-'}</span>}
                          <button onClick={() => handleRemoveMember(g, m.externalProviderArrangementInstanceReference)} disabled={isBusy}
                            className="ml-auto text-xs text-red-600 hover:underline disabled:opacity-50">Remove</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {available.length > 0 && (
                    <div className="pt-1">
                      <select defaultValue="" disabled={isBusy}
                        onChange={(e) => { handleAddMember(g, e.target.value); e.currentTarget.value = ''; }}
                        className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
                        <option value="" disabled>+ Add a {TYPE_LABEL[g.routingGroupProviderType]} provider…</option>
                        {available.map((p) => (
                          <option key={p.externalProviderArrangementInstanceReference} value={p.externalProviderArrangementInstanceReference}>
                            {p.externalProviderArrangementName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <Pagination
            page={safePage}
            totalPages={totalPages}
            total={filtered.length}
            limit={PAGE_SIZE}
            onPageChange={setPage}
            noun="groups"
          />
        </div>
      )}
    </div>
  );
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus, CheckCircle2, AlertCircle, Clock, WifiOff,
  RefreshCw, Trash2, Search, X, Filter, Pencil, Eye,
  ShieldAlert, ScanLine, UserCheck, Building2, AlertTriangle, CreditCard, Puzzle,
  GitBranch, ArrowRight, Zap, ChevronDown, KeyRound, Landmark, Send,
  type LucideIcon,
} from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';
import { useDebugMode } from '../../../../lib/debugMode';
import { Pagination } from '../../../../components/Pagination';
import { SectionHeader } from '../../../../components/SectionHeader';
import { CATEGORY_CONTRACTS, CATEGORY_TRIGGER_EVENTS } from './categoryContracts';
import { useConfirm, useNotify } from '../../../../components/ui/ConfirmProvider';

// ── Types ──────────────────────────────────────────────────────────────────

interface Integration {
  externalProviderArrangementInstanceReference: string;
  externalProviderArrangementName: string;
  externalProviderArrangementType: string;
  externalProviderArrangementStatus: string;
  externalProviderIsInternal: boolean;
  externalProviderMode: string;
  externalProviderApiKeyPrefix?: string;
  externalProviderApiEndpoint?: string;
  externalProviderHealthStatus?: string;
  externalProviderLastHealthCheckAt?: string;
  routingGroupId?: string;
  routingPriority?: number;
  bianServiceDomain: string;
  pciDssRequirements: string[];
  recordCreatedDateTime: string;
}

interface RoutingGroupMember {
  externalProviderArrangementInstanceReference: string;
  memberPriority: number;
  memberRole?: string;
  memberWeight?: number;
}

interface RoutingGroup {
  routingGroupInstanceReference: string;
  routingGroupName: string;
  routingGroupStrategy: string;
  routingGroupStatus: string;
  isDefaultGroup: boolean;
  routingGroupMembers: RoutingGroupMember[];
}

// Only serializable values, no React components
export interface CategoryMeta {
  type: string;
  label: string;
  description: string;
  bianSd: string;
}

const ICON_BY_TYPE: Record<string, LucideIcon> = {
  fraud_detection:    ShieldAlert,
  hrp_sanctions:      ScanLine,
  kyc_identity:       UserCheck,
  kyb_business:       Building2,
  aml_monitoring:     AlertTriangle,
  credit_bureau:      CreditCard,
  card_authorization: Zap,
  card_issuer:        KeyRound,
  account_information: Landmark,
  payment_initiation:  Send,
  generic:            Puzzle,
};

const STRATEGY_LABELS: Record<string, string> = {
  primary_fallback: 'Primary / Fallback',
  round_robin:      'Round Robin',
  weighted:         'Weighted',
  parallel:         'Parallel',
};

const STRATEGY_DESCRIPTIONS: Record<string, string> = {
  primary_fallback: 'Tries the primary provider first. On failure or unreachable, cascades to the next by priority.',
  round_robin:      'Distributes requests evenly across all active providers in rotation.',
  weighted:         'Sends traffic proportionally to each provider by configured weight (0–100).',
  parallel:         'Calls all active providers simultaneously. Returns first success or aggregates results.',
};

// ── Status helpers ─────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', inactive: 'Inactive', test: 'Test', suspended: 'Suspended',
};

function HealthDot({ status }: { status?: string }) {
  if (!status || status === 'unknown') return <span title="Unknown"><Clock size={14} className="text-gray-400" /></span>;
  if (status === 'ok')          return <span title="Healthy"><CheckCircle2 size={14} className="text-green-600" /></span>;
  if (status === 'degraded')    return <span title="Degraded"><AlertCircle size={14} className="text-amber-600" /></span>;
  if (status === 'unreachable') return <span title="Unreachable"><WifiOff size={14} className="text-red-600" /></span>;
  return null;
}

function RoleBadge({ role, priority }: { role?: string; priority?: number }) {
  if (priority === 999)
    return <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 font-medium">Fallback terminal</span>;
  if (role === 'primary')
    return <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200 font-medium">Primary</span>;
  if (role === 'fallback')
    return <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">Fallback</span>;
  if (role === 'peer')
    return <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">Peer</span>;
  return <span className="text-xs text-gray-400">-</span>;
}

const PAGE_SIZE = 10;

// ── Sub-sections ───────────────────────────────────────────────────────────

function GroupConfigSection({ type, token }: { type: string; token: string }) {
  const [group, setGroup]         = useState<RoutingGroup | null>(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [strategy, setStrategy]   = useState('');
  const [expanded, setExpanded]   = useState(false);

  useEffect(() => {
    api.integrationGroups.getDefault(type, token)
      .then(d => {
        const g = d.group as unknown as RoutingGroup;
        setGroup(g);
        setStrategy(g.routingGroupStrategy);
      })
      .catch(() => setGroup(null))
      .finally(() => setLoading(false));
  }, [type, token]);

  async function handleStrategyChange(newStrategy: string) {
    if (!group || newStrategy === group.routingGroupStrategy) return;
    setSaving(true);
    try {
      const d = await api.integrationGroups.updateStrategy(
        group.routingGroupInstanceReference, newStrategy, token
      );
      const updated = d.group as unknown as RoutingGroup;
      setGroup(updated);
      setStrategy(updated.routingGroupStrategy);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="bg-white rounded-xl border p-4 text-sm text-gray-400">Loading group configuration…</div>
  );

  if (!group) return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
      No default group found for this category. Re-run seed to initialize.
    </div>
  );

  const externalMembers = group.routingGroupMembers.filter(m => m.memberPriority < 999);
  const internalMembers = group.routingGroupMembers.filter(m => m.memberPriority >= 999);
  const activeCount     = group.routingGroupStatus === 'active' ? externalMembers.length : 0;

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-violet-50 rounded-lg">
            <GitBranch size={16} className="text-violet-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{group.routingGroupName}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {STRATEGY_LABELS[group.routingGroupStrategy] ?? group.routingGroupStrategy}
              {' · '}
              {externalMembers.length} external + {internalMembers.length} internal provider{group.routingGroupMembers.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${group.routingGroupStatus === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {group.routingGroupStatus}
          </span>
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div className="border-t px-5 py-4 space-y-4">
          {/* Strategy selector */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Routing Strategy</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(STRATEGY_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => handleStrategyChange(key)}
                  disabled={saving}
                  className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors disabled:opacity-50 ${
                    strategy === key
                      ? 'border-violet-400 bg-violet-50 text-violet-900'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  <p className="font-medium">{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{STRATEGY_DESCRIPTIONS[key]}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Member chain preview */}
          {group.routingGroupMembers.length > 0 && (
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Dispatch chain (sorted by priority)</label>
              <div className="flex flex-wrap items-center gap-1.5">
                {[...group.routingGroupMembers]
                  .sort((a, b) => a.memberPriority - b.memberPriority)
                  .map((m, idx, arr) => (
                    <div key={m.externalProviderArrangementInstanceReference} className="flex items-center gap-1.5">
                      <div className={`text-xs px-2 py-1 rounded-lg border font-mono ${
                        m.memberPriority >= 999
                          ? 'bg-slate-50 border-slate-200 text-slate-500'
                          : idx === 0
                          ? 'bg-green-50 border-green-200 text-green-800'
                          : 'bg-amber-50 border-amber-200 text-amber-800'
                      }`}>
                        <span className="font-medium text-[10px] mr-1">{m.memberPriority >= 999 ? '∞' : m.memberPriority}</span>
                        {m.externalProviderArrangementInstanceReference.substring(0, 18)}…
                      </div>
                      {idx < arr.length - 1 && <ArrowRight size={12} className="text-gray-300 shrink-0" />}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {activeCount === 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              No external providers in this group yet. Register a provider to activate the dispatch chain.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type ContractTab = 'inputs' | 'outputs';

function DataContractSection({ type }: { type: string }) {
  const [tab, setTab] = useState<ContractTab>('inputs');
  const [expanded, setExpanded] = useState(false);
  const contract = CATEGORY_CONTRACTS[type];

  if (!contract) return null;

  const fields = tab === 'inputs' ? contract.inputs : contract.outputs;

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-50 rounded-lg">
            <ArrowRight size={16} className="text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Data Contract</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {contract.inputs.length} input fields · {contract.outputs.length} output fields
            </p>
          </div>
        </div>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t">
          {/* Tab bar */}
          <div className="flex border-b bg-gray-50">
            {(['inputs', 'outputs'] as ContractTab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors capitalize ${
                  tab === t ? 'bg-white border-b-2 border-blue-500 text-blue-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'inputs' ? '↑ Inputs (sent to provider)' : '↓ Outputs (received from provider)'}
              </button>
            ))}
          </div>

          {/* Fields table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="text-left px-4 py-2.5 font-medium">Field</th>
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Description</th>
                  <th className="text-center px-4 py-2.5 font-medium">Required</th>
                </tr>
              </thead>
              <tbody>
                {fields.map(f => (
                  <tr key={f.name} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-800">{f.name}</code>
                        {f.pciSensitive && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 font-medium">PCI</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-gray-500 font-mono">{f.type}</span>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <span className="text-xs text-gray-600">{f.description}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {f.required
                        ? <CheckCircle2 size={14} className="text-green-600 mx-auto" />
                        : <span className="text-xs text-gray-400">opt</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="px-4 py-2.5 text-xs text-gray-400 border-t bg-gray-50">
            Field names can be remapped per provider via the outbound/inbound field mapping configuration.
          </p>
        </div>
      )}
    </div>
  );
}

function SystemEventsSection({ type }: { type: string }) {
  const [expanded, setExpanded] = useState(false);
  const events = CATEGORY_TRIGGER_EVENTS[type] ?? [];

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-amber-50 rounded-lg">
            <Zap size={16} className="text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">System Events</p>
            <p className="text-xs text-gray-500 mt-0.5">{events.length} trigger event{events.length !== 1 ? 's' : ''} for this category</p>
          </div>
        </div>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t divide-y">
          {events.map(e => (
            <div key={e.event} className="px-5 py-3 flex items-start gap-3">
              <code className="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-2 py-1 rounded font-mono whitespace-nowrap mt-0.5">
                {e.event}
              </code>
              <p className="text-sm text-gray-600">{e.description}</p>
            </div>
          ))}
          {events.length === 0 && (
            <p className="px-5 py-3 text-sm text-gray-400">No canonical events defined for this type.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function IntegrationCategoryPage({ meta }: { meta: CategoryMeta }) {
  const token = getToken() ?? '';
  const confirm = useConfirm();
  const notify = useNotify();
  const { debugMode } = useDebugMode();

  const [allRows, setAllRows] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { status: string; latencyMs: number }>>({});
  const [deleting, setDeleting] = useState<string | null>(null);

  // filters
  const [nameInput, setNameInput]       = useState('');
  const [nameFilter, setNameFilter]     = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // pagination
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const load = useCallback(() => {
    setLoading(true);
    api.integrations.list(token, { type: meta.type, ...(statusFilter ? { status: statusFilter } : {}) })
      .then(d => { setAllRows(d.integrations as unknown as Integration[]); })
      .catch(() => { setAllRows([]); })
      .finally(() => setLoading(false));
  }, [token, meta.type, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = allRows.filter(i =>
    !nameFilter || i.externalProviderArrangementName.toLowerCase().includes(nameFilter.toLowerCase())
  );

  // Sort by routingPriority ASC (lower = higher priority), internals (999) at end
  const sorted = [...filtered].sort((a, b) => (a.routingPriority ?? 100) - (b.routingPriority ?? 100));

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paginated  = sorted.slice((page - 1) * pageSize, page * pageSize);
  const hasFilters = !!nameFilter || !!statusFilter;

  function handleSearch() { setNameFilter(nameInput.trim()); setPage(1); }
  function handleClear()  { setNameInput(''); setNameFilter(''); setStatusFilter(''); setPage(1); }

  async function handleTest(id: string) {
    setTesting(id);
    try {
      const r = await api.integrations.test(id, token);
      setTestResult(prev => ({ ...prev, [id]: r }));
      load();
    } catch {
      setTestResult(prev => ({ ...prev, [id]: { status: 'error', latencyMs: 0 } }));
    } finally { setTesting(null); }
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: `Delete "${name}"?`,
      message: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setDeleting(id);
    try {
      await api.integrations.delete(id, token);
      load();
    } catch (err) {
      notify((err as Error).message ?? 'Failed to delete provider.', 'error');
    } finally { setDeleting(null); }
  }

  const Icon = ICON_BY_TYPE[meta.type] ?? Puzzle;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      {/* Header; shared SectionHeader (icon + title + subtitle), consistent across /system */}
      <SectionHeader
        icon={Icon}
        title={meta.label}
        description={meta.description}
        debugInfo={`${meta.bianSd} · SD-193 · PCI DSS Req 12.8.1`}
        actions={
          <Link
            href={`/system/admin/providers/vendors/new?type=${meta.type}`}
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium"
          >
            <Plus size={14} />
            Register Provider
          </Link>
        }
      />

      {/* ── Group Configuration ─────────────────────────────────────────── */}
      <GroupConfigSection type={meta.type} token={token} />

      {/* ── Data Contract ───────────────────────────────────────────────── */}
      <DataContractSection type={meta.type} />

      {/* ── System Events ───────────────────────────────────────────────── */}
      <SystemEventsSection type={meta.type} />

      {/* ── Providers ───────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          Providers
          <span className="text-xs text-gray-400 font-normal">(ordered by routing priority)</span>
        </h2>

        {/* Search + filter */}
        <div className="bg-white rounded-xl border p-4 space-y-3 mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search by provider name…"
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
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="border rounded-lg px-3 py-1.5 text-sm bg-white"
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className="text-gray-400 text-sm ml-auto">{sorted.length} provider{sorted.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading providers...</div>
        ) : paginated.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
            No providers found{hasFilters ? ' matching current filters.' : '. '}
            {!hasFilters && (
              <Link href={`/system/admin/providers/vendors/new?type=${meta.type}`} className="underline font-medium">Register one now.</Link>
            )}
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                    <th className="text-left px-4 py-3 font-medium w-6">Priority</th>
                    <th className="text-left px-4 py-3 font-medium">Provider</th>
                    <th className="text-left px-4 py-3 font-medium">Mode</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Health</th>
                    <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Role</th>
                    {debugMode && <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Registered</th>}
                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(i => {
                    const id = i.externalProviderArrangementInstanceReference;
                    const priority = i.routingPriority ?? 100;
                    return (
                      <tr key={id} className="border-b last:border-0 hover:bg-gray-50">
                        {/* Priority */}
                        <td className="px-4 py-3">
                          <span className={`text-xs font-mono font-semibold ${priority >= 999 ? 'text-slate-400' : priority <= 20 ? 'text-green-700' : 'text-amber-700'}`}>
                            {priority >= 999 ? '999' : priority}
                          </span>
                        </td>
                        {/* Provider */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{i.externalProviderArrangementName}</span>
                            {i.externalProviderIsInternal && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium border border-slate-200">Built-in</span>
                            )}
                          </div>
                          {i.externalProviderApiKeyPrefix && (
                            <span className="text-xs text-gray-400 font-mono">{i.externalProviderApiKeyPrefix}</span>
                          )}
                          {i.externalProviderApiEndpoint && (
                            <p className="text-xs text-gray-400 truncate max-w-[220px]">{i.externalProviderApiEndpoint}</p>
                          )}
                        </td>
                        {/* Mode */}
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${i.externalProviderMode === 'sync' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                            {i.externalProviderMode}
                          </span>
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                            i.externalProviderArrangementStatus === 'active'    ? 'bg-green-100 text-green-700' :
                            i.externalProviderArrangementStatus === 'inactive'  ? 'bg-gray-100 text-gray-600' :
                            i.externalProviderArrangementStatus === 'test'      ? 'bg-blue-100 text-blue-700' :
                                                                                  'bg-red-100 text-red-700'
                          }`}>
                            {STATUS_LABEL[i.externalProviderArrangementStatus] ?? i.externalProviderArrangementStatus}
                          </span>
                        </td>
                        {/* Health */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <HealthDot status={i.externalProviderHealthStatus} />
                            {testResult[id] && (
                              <span className={`text-xs ${testResult[id].status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                                {testResult[id].status === 'ok' ? `${testResult[id].latencyMs}ms` : 'failed'}
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Role */}
                        <td className="px-4 py-3 hidden md:table-cell">
                          <RoleBadge priority={priority} role={undefined} />
                        </td>
                        {debugMode && (
                          <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">
                            {new Date(i.recordCreatedDateTime).toLocaleDateString()}
                          </td>
                        )}
                        {/* Actions */}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleTest(id)}
                              disabled={testing === id}
                              title="Run connectivity test"
                              className="flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
                            >
                              <RefreshCw size={11} className={testing === id ? 'animate-spin' : ''} />
                              <span className="hidden sm:inline">Test</span>
                            </button>
                            <Link
                              href={`/system/admin/providers/vendors/${id}`}
                              className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded border transition-colors ${
                                i.externalProviderIsInternal
                                  ? 'border-gray-200 hover:border-gray-400 text-gray-500 hover:text-gray-700'
                                  : 'border-blue-200 hover:border-blue-400 text-blue-600 hover:text-blue-800'
                              }`}
                            >
                              {i.externalProviderIsInternal ? <Eye size={11} /> : <Pencil size={11} />}
                              <span className="hidden sm:inline">{i.externalProviderIsInternal ? 'View' : 'Edit'}</span>
                            </Link>
                            {!i.externalProviderIsInternal && (
                              <button
                                onClick={() => handleDelete(id, i.externalProviderArrangementName)}
                                disabled={deleting === id}
                                title="Delete provider"
                                className="flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-red-200 hover:border-red-400 text-red-600 hover:text-red-800 transition-colors disabled:opacity-50"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              totalPages={totalPages}
              total={sorted.length}
              limit={pageSize}
              onPageChange={p => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              onLimitChange={l => { setPageSize(l); setPage(1); }}
              limitOptions={[10, 20, 50]}
              noun="providers"
            />
          </>
        )}
      </div>
    </div>
  );
}

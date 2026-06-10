'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus, CheckCircle2, AlertCircle, Clock, WifiOff,
  RefreshCw, Trash2, Search, X, Filter, Pencil, Eye,
  ShieldAlert, ScanLine, UserCheck, Building2, AlertTriangle, CreditCard, Puzzle,
} from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';
import { useDebugMode } from '../../../../lib/debugMode';
import { Pagination } from '../../../../components/Pagination';

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

// Only serializable values — no React components
export interface CategoryMeta {
  type: string;
  label: string;
  description: string;
  bianSd: string;
}

const ICON_BY_TYPE: Record<string, React.ElementType> = {
  fraud_detection: ShieldAlert,
  hrp_sanctions:   ScanLine,
  kyc_identity:    UserCheck,
  kyb_business:    Building2,
  aml_monitoring:  AlertTriangle,
  credit_bureau:   CreditCard,
  generic:         Puzzle,
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

const PAGE_SIZE = 10;

// ── Component ──────────────────────────────────────────────────────────────

export function IntegrationCategoryPage({ meta }: { meta: CategoryMeta }) {
  const token = getToken() ?? '';
  const { debugMode } = useDebugMode();

  const [allRows, setAllRows] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { status: string; latencyMs: number }>>({});
  const [deleting, setDeleting] = useState<string | null>(null);

  // filters
  const [nameInput, setNameInput]     = useState('');
  const [nameFilter, setNameFilter]   = useState('');
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
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice((page - 1) * pageSize, page * pageSize);
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
    if (!confirm(`Delete "${name}"? This action cannot be undone.`)) return;
    setDeleting(id);
    try {
      await api.integrations.delete(id, token);
      load();
    } catch (err) {
      alert((err as Error).message ?? 'Failed to delete provider.');
    } finally { setDeleting(null); }
  }

  const Icon = ICON_BY_TYPE[meta.type] ?? Puzzle;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-slate-100 rounded-xl mt-0.5">
            <Icon size={20} className="text-slate-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{meta.label}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{meta.description}</p>
            {debugMode && (
              <p className="text-xs text-gray-400 font-mono mt-0.5">{meta.bianSd} · SD-193 · PCI DSS Req 12.8.1</p>
            )}
          </div>
        </div>
        <Link
          href={`/system/admin/integrations/new?type=${meta.type}`}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium"
        >
          <Plus size={14} />
          Register Provider
        </Link>
      </div>

      {/* Search + filter */}
      <div className="bg-white rounded-xl border p-4 space-y-3">
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
          <span className="text-gray-400 text-sm ml-auto">{filtered.length} provider{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading providers...</div>
      ) : paginated.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          No providers found{hasFilters ? ' matching current filters.' : `. `}
          {!hasFilters && (
            <Link href={`/system/admin/integrations/new?type=${meta.type}`} className="underline font-medium">Register one now.</Link>
          )}
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="text-left px-4 py-3 font-medium">Provider</th>
                  <th className="text-left px-4 py-3 font-medium">Mode</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Health</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Routing</th>
                  {debugMode && <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Registered</th>}
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(i => {
                  const id = i.externalProviderArrangementInstanceReference;
                  return (
                    <tr key={id} className="border-b last:border-0 hover:bg-gray-50">
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
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${i.externalProviderMode === 'sync' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                          {i.externalProviderMode}
                        </span>
                      </td>
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
                      <td className="px-4 py-3 hidden md:table-cell">
                        {i.routingGroupId ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 font-medium">
                            {(i.routingPriority ?? 100) <= 50 ? 'Primary' : 'Fallback'}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Single</span>
                        )}
                      </td>
                      {debugMode && (
                        <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">
                          {new Date(i.recordCreatedDateTime).toLocaleDateString()}
                        </td>
                      )}
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
                            href={`/system/admin/integrations/${id}`}
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
            total={filtered.length}
            limit={pageSize}
            onPageChange={p => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            onLimitChange={l => { setPageSize(l); setPage(1); }}
            limitOptions={[10, 20, 50]}
            noun="providers"
          />
        </>
      )}
    </div>
  );
}

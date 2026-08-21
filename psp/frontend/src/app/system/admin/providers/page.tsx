'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plus, CheckCircle2, AlertCircle, Clock, WifiOff, RefreshCw, Pause,
  Filter, Search, X, Plug,
} from 'lucide-react';
import { api } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';
import { useDebugMode } from '../../../../lib/debugMode';
import { ROLE_LABELS } from '../../../../lib/constants';
import { Pagination } from '../../../../components/Pagination';
import { useNotify } from '../../../../components/ui/ConfirmProvider';
import { SectionHeader } from '../../../../components/SectionHeader';
import { CAPABILITY_LIST } from '../../../../config/capabilities';

import { serviceDomainLabel } from '../../../../lib/serviceDomain';
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CAPABILITY_LIST.map((c) => [c.providerType, c.label])
);

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

const STATUS_LABEL: Record<string, string> = {
  active:    'Active',
  inactive:  'Inactive',
  test:      'Test',
  suspended: 'Suspended',
};

const PAGE_SIZE = 10;

function HealthDot({ status }: { status?: string }) {
  if (!status || status === 'unknown')  return <span title="Unknown"><Clock size={14} className="text-gray-400" /></span>;
  if (status === 'ok')                  return <span title="Healthy"><CheckCircle2 size={14} className="text-green-600" /></span>;
  if (status === 'degraded')            return <span title="Degraded"><AlertCircle size={14} className="text-amber-600" /></span>;
  if (status === 'unreachable')         return <span title="Unreachable"><WifiOff size={14} className="text-red-600" /></span>;
  return null;
}

export default function IntegrationsListPage() {
  const [allIntegrations, setAllIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading]   = useState(true);
  const [testing, setTesting]   = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { status: string; latencyMs: number }>>({});
  const { debugMode } = useDebugMode();
  const notify = useNotify();

  // Filters
  const [nameInput, setNameInput]   = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Pagination
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const token = getToken() ?? '';

  const load = useCallback(async (type: string, status: string) => {
    setLoading(true);
    try {
      const params: { type?: string; status?: string } = {};
      if (type)   params.type   = type;
      if (status) params.status = status;
      const d = await api.integrations.list(token, params);
      setAllIntegrations(d.integrations as unknown as Integration[]);
    } catch {
      setAllIntegrations([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load('', ''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side name filter + pagination
  const filtered = allIntegrations.filter(i =>
    !nameFilter || i.externalProviderArrangementName.toLowerCase().includes(nameFilter.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice((page - 1) * pageSize, page * pageSize);
  const hasFilters = !!nameFilter || !!typeFilter || !!statusFilter;

  function handleSearch() {
    setNameFilter(nameInput.trim());
    setPage(1);
  }

  function handleTypeChange(v: string) {
    setTypeFilter(v);
    setPage(1);
    load(v, statusFilter);
  }

  function handleStatusChange(v: string) {
    setStatusFilter(v);
    setPage(1);
    load(typeFilter, v);
  }

  function handleClear() {
    setNameInput('');
    setNameFilter('');
    setTypeFilter('');
    setStatusFilter('');
    setPage(1);
    load('', '');
  }

  function handlePageChange(p: number) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleTest(id: string) {
    setTesting(id);
    try {
      const r = await api.integrations.test(id, token);
      setTestResult(prev => ({ ...prev, [id]: r }));
      load(typeFilter, statusFilter);
    } catch {
      setTestResult(prev => ({ ...prev, [id]: { status: 'error', latencyMs: 0 } }));
    } finally {
      setTesting(null);
    }
  }

  async function handleSuspend(id: string) {
    try {
      await api.integrations.suspend(id, token);
      load(typeFilter, statusFilter);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  }

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">

      <SectionHeader
        icon={Plug}
        title="Providers"
        description="External provider vendors and their arrangements."
        debugInfo="ExternalProviderArrangement · PCI DSS"
        actions={
          <Link
            href="/system/admin/providers/vendors/new"
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium"
          >
            <Plus size={14} />
            Register Provider
          </Link>
        }
      />

      {/* Search + filters */}
      <div className="bg-white rounded-xl border p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
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
            value={typeFilter}
            onChange={(e) => handleTypeChange(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All types</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="text-gray-400 text-sm self-center ml-auto">{filtered.length} providers</span>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading integrations...</div>
      ) : paginated.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          No integrations found{hasFilters ? ' matching the current filters.' : '.'}
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="text-left px-4 py-3 font-medium">Provider</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Mode</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Health</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Routing</th>
                  {debugMode && <th className="text-left px-4 py-3 font-medium">BIAN</th>}
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(i => (
                  <tr key={i.externalProviderArrangementInstanceReference} className="border-b last:border-0 hover:bg-gray-50">
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
                    </td>
                    <td className="px-4 py-3 text-gray-600">{TYPE_LABEL[i.externalProviderArrangementType] ?? i.externalProviderArrangementType}</td>
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
                        {testResult[i.externalProviderArrangementInstanceReference] && (
                          <span className={`text-xs ${testResult[i.externalProviderArrangementInstanceReference].status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                            {testResult[i.externalProviderArrangementInstanceReference].latencyMs}ms
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
                      <td className="px-4 py-3 text-xs text-gray-400 font-mono">{serviceDomainLabel(i.bianServiceDomain)}</td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleTest(i.externalProviderArrangementInstanceReference)}
                          disabled={testing === i.externalProviderArrangementInstanceReference}
                          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
                        >
                          <RefreshCw size={11} className={testing === i.externalProviderArrangementInstanceReference ? 'animate-spin' : ''} />
                          Test
                        </button>
                        {!i.externalProviderIsInternal && i.externalProviderArrangementStatus !== 'suspended' && (
                          <button
                            onClick={() => handleSuspend(i.externalProviderArrangementInstanceReference)}
                            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-red-200 hover:border-red-400 text-red-600 hover:text-red-800 transition-colors"
                          >
                            <Pause size={11} />
                            Suspend
                          </button>
                        )}
                        <Link
                          href={`/system/admin/providers/vendors/${i.externalProviderArrangementInstanceReference}`}
                          className="text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:border-gray-400 text-gray-600 hover:text-gray-900 transition-colors"
                        >
                          Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={filtered.length}
            limit={pageSize}
            onPageChange={handlePageChange}
            onLimitChange={(l) => { setPageSize(l); setPage(1); }}
            limitOptions={[10, 20, 50]}
            noun="providers"
          />
        </>
      )}

      {debugMode && (
        <div className="text-xs text-gray-400 font-mono">
          {ROLE_LABELS['manager']} · PCI DSS; maintained list of all third-party service providers
        </div>
      )}
    </div>
  );
}

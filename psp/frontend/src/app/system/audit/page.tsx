'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { api, AuditEventWithCase } from '../../../lib/api';
import { getToken } from '../../../lib/auth';
import { PERFORMER_LABELS } from '../../../lib/constants';
import Link from 'next/link';
import { Filter, X, ShieldCheck, BarChart3, Activity } from 'lucide-react';
import { SectionHeader } from '../../../components/SectionHeader';
import { useDebugMode } from '../../../lib/debugMode';
import { Pagination } from '../../../components/Pagination';

const OUTCOME_STYLES: Record<string, string> = {
  approved:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
  pending:   'bg-yellow-100 text-yellow-700',
  failed:    'bg-red-100 text-red-700',
  escalated: 'bg-purple-100 text-purple-700',
};

function ProcessEventsTab({ compliance = false }: { compliance?: boolean }) {
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p = 1, ps = 20) => {
    const token = getToken() ?? '';
    setLoading(true);
    try {
      const res = compliance
        ? await api.processEvents.listCompliance(token, { page: p, limit: ps })
        : await api.processEvents.list(token, { page: p, limit: ps });
      setEvents(res.events as Record<string, unknown>[]);
      setTotal(res.total);
    } catch { setEvents([]); setTotal(0); }
    setLoading(false);
  }, [compliance]);

  useEffect(() => { load(1, pageSize); }, [compliance, pageSize, load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-8 text-center text-sm text-gray-400">Loading…</div>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-8 text-center text-sm text-gray-400">No events yet. Events appear after business processes execute.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200">
          <ul className="divide-y divide-gray-100">
            {events.map((ev, i) => (
              <li key={(ev.businessProcessEventInstanceReference as string) ?? i} className="px-5 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-[#001E2B] font-semibold">{ev.processAction as string}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OUTCOME_STYLES[ev.processOutcome as string] ?? 'bg-gray-100 text-gray-600'}`}>{ev.processOutcome as string}</span>
                      <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{ev.processType as string}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      <span className="font-medium">{ev.entityType as string}</span>
                      {' · '}
                      <span className="font-mono">{(ev.entityId as string)?.slice(0, 12)}…</span>
                      {ev.performedByRole ? <> · <span>{ev.performedByRole as string}</span></> : null}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 shrink-0 tabular-nums">
                    {new Date(ev.eventDateTime as string).toLocaleString()}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="px-3 py-2 border-t border-gray-100">
            <Pagination page={page} totalPages={totalPages} total={total} limit={pageSize}
              onPageChange={(p) => { setPage(p); load(p, pageSize); }}
              onLimitChange={(l) => { setPageSize(l); setPage(1); load(1, l); }}
              limitOptions={[10, 20, 50]} noun="events" />
          </div>
        </div>
      )}
    </div>
  );
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  case_opened: 'Case Opened',
  assigned: 'Assigned',
  note_added: 'Note Added',
  field_accessed: 'Sensitive Field Accessed',
  escalated: 'Escalated to L2',
  ai_review: 'AI Pre-Review',
  resolved: 'Resolved',
  closed: 'Closed',
};

const ACTION_TYPE_COLORS: Record<string, string> = {
  case_opened: 'bg-blue-100 text-blue-800',
  assigned: 'bg-gray-100 text-gray-700',
  note_added: 'bg-gray-100 text-gray-700',
  field_accessed: 'bg-purple-100 text-purple-800',
  escalated: 'bg-yellow-100 text-yellow-800',
  ai_review: 'bg-indigo-100 text-indigo-800',
  resolved: 'bg-green-100 text-green-800',
  closed: 'bg-gray-100 text-gray-600',
};

const PAGE_SIZE = 10;

type AuditTab = 'fraud' | 'process' | 'compliance';

export default function AuditPage() {
  const { debugMode } = useDebugMode();
  const [activeTab, setActiveTab] = useState<AuditTab>('fraud');
  const [events, setEvents] = useState<AuditEventWithCase[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('');
  const [filterAction, setFilterAction] = useState('');

  const load = useCallback(async (p: number, ps: number) => {
    setLoading(true);
    const t = getToken() ?? '';
    try {
      const res = await api.fraud.allEvents({ page: p, limit: ps }, t);
      setEvents(res.events);
      setTotal(res.total);
    } catch {
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1, pageSize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePageChange(newPage: number) {
    setPage(newPage);
    load(newPage, pageSize);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleLimitChange(newLimit: number) {
    setPageSize(newLimit);
    setPage(1);
    load(1, newLimit);
  }

  function handleRoleFilter(role: string) {
    setFilterRole(role);
    setPage(1);
    load(1, pageSize);
  }

  function handleActionFilter(action: string) {
    setFilterAction(action);
    setPage(1);
    load(1, pageSize);
  }

  const filtered = events.filter((e) => {
    if (filterRole && e.performedByRole !== filterRole) return false;
    if (filterAction && e.actionType !== filterAction) return false;
    return true;
  });

  const uniqueRoles = [...new Set(events.map((e) => e.performedByRole))];
  const uniqueActions = [...new Set(events.map((e) => e.actionType))];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-h-screen bg-gray-50">

      <main className="w-full px-5 sm:px-8 lg:px-12 py-6">
        <div className="mb-4">
          <SectionHeader
            icon={BarChart3}
            title="Audit Log"
            description="Immutable event trail across all fraud cases and business processes."
            debugInfo="(append-only events) · PCI DSS (logging & monitoring) · ADR-025 (businessProcessEvent timeseries)"
          />
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-5">
          {([['fraud', 'Fraud Cases', BarChart3], ['process', 'Process Events', Activity], ['compliance', 'Compliance Events', ShieldCheck]] as [AuditTab, string, React.ElementType][]).map(([t, label, Icon]) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? 'bg-white shadow text-[#001E2B]' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon size={13} />{label}
            </button>
          ))}
        </div>

        {activeTab === 'process' && <ProcessEventsTab compliance={false} />}
        {activeTab === 'compliance' && <ProcessEventsTab compliance={true} />}

        {activeTab === 'fraud' && <>
        {/* Access model context, debug mode only */}
        {debugMode && (
          <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm mb-5">
            <strong>Security Auditor access (Level 4):</strong> Read-only oversight across all cases and roles.
            You can inspect access logs, escalations, field accesses, and control evidence.
            You cannot modify cases, rules, or customer data. Segregation of duties is enforced.
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap items-center">
          <Filter size={14} className="text-gray-400 shrink-0" />
          <select
            value={filterRole}
            onChange={(e) => handleRoleFilter(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All roles</option>
            {uniqueRoles.map((r) => (
              <option key={r} value={r}>{PERFORMER_LABELS[r] ?? r}</option>
            ))}
          </select>
          <select
            value={filterAction}
            onChange={(e) => handleActionFilter(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All action types</option>
            {uniqueActions.map((a) => (
              <option key={a} value={a}>{ACTION_TYPE_LABELS[a] ?? a}</option>
            ))}
          </select>
          {(filterRole || filterAction) && (
            <button
              onClick={() => { setFilterRole(''); setFilterAction(''); setPage(1); load(1, pageSize); }}
              className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
            >
              <X size={13} />
              Clear filters
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading audit events...</div>
        ) : (
          <>
            <div className="bg-white rounded-xl border overflow-x-auto">
              <table className="min-w-full text-sm divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['Datetime (UTC)', 'Case', 'Action', 'Role', 'Details'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                        {events.length === 0
                          ? 'No audit events found. Events are recorded when fraud cases are created, escalated, or resolved.'
                          : 'No events match the current filters.'}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((e, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">
                          {new Date(e.actionDateTime).toISOString().replace('T', ' ').slice(0, 19)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {e.fraudDiagnosisCaseReference ? (
                            <Link
                              href={`/system/investigation/${e.fraudDiagnosisInstanceReference}`}
                              className="text-blue-600 hover:underline"
                            >
                              {e.fraudDiagnosisCaseReference}
                            </Link>
                          ) : (
                            <span className="text-gray-400">{e.fraudDiagnosisInstanceReference?.slice(0, 8)}...</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${ACTION_TYPE_COLORS[e.actionType] ?? 'bg-gray-100 text-gray-700'}`}>
                            {ACTION_TYPE_LABELS[e.actionType] ?? e.actionType.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 text-xs">
                          {PERFORMER_LABELS[e.performedByRole] ?? e.performedByRole}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs max-w-xs truncate">
                          {e.actionDetails && Object.keys(e.actionDetails).length > 0
                            ? Object.entries(e.actionDetails)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(', ')
                            : '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              limit={pageSize}
              onPageChange={handlePageChange}
              onLimitChange={handleLimitChange}
              limitOptions={[10, 20, 50, 100]}
              noun="events"
            />
          </>
        )}

        {/* Audit control context, debug mode only */}
        {debugMode && !loading && events.length > 0 && (
          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="bg-white border rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <ShieldCheck size={14} className="text-green-600" />
                <p className="font-semibold text-gray-700">Access controls verified</p>
              </div>
              <p className="text-gray-500 text-xs">
                Events for <code>field_accessed</code> confirm that sensitive QE:none fields were accessed
                only by authorized Level 2 investigators with valid escalation tokens.
              </p>
            </div>
            <div className="bg-white border rounded-xl p-4">
              <p className="font-semibold text-gray-700 mb-1">Immutable trail</p>
              <p className="text-gray-500 text-xs">
                All events in <code>fraudDiagnosisCaseEvents</code> are append-only. No event can be
                modified or deleted by any application role, including Security Auditor.
              </p>
            </div>
            <div className="bg-white border rounded-xl p-4">
              <p className="font-semibold text-gray-700 mb-1">PCI DSS</p>
              <p className="text-gray-500 text-xs">
                This audit trail satisfies Requirement 10: track and monitor all access to network
                resources and cardholder data. Timestamp, role, and action type are recorded for
                every event.
              </p>
            </div>
          </div>
        )}
        </>}
      </main>
    </div>
  );
}

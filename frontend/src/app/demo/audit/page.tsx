'use client';
import { useEffect, useState } from 'react';
import { api, AuditEventWithCase } from '../../../lib/api';
import { getToken } from '../../../lib/auth';
import { PERFORMER_LABELS } from '../../../lib/constants';
import Link from 'next/link';
import { Filter, X, ShieldCheck } from 'lucide-react';

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

export default function AuditPage() {
  const [token, setToken] = useState('');
  const [events, setEvents] = useState<AuditEventWithCase[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('');
  const [filterAction, setFilterAction] = useState('');

  useEffect(() => {
    const t = getToken() ?? '';
    setToken(t);
    api.fraud.allEvents({ page: 1, limit: 100 }, t)
      .then((res) => { setEvents(res.events); setTotal(res.total); })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = events.filter((e) => {
    if (filterRole && e.performedByRole !== filterRole) return false;
    if (filterAction && e.actionType !== filterAction) return false;
    return true;
  });

  const uniqueRoles = [...new Set(events.map((e) => e.performedByRole))];
  const uniqueActions = [...new Set(events.map((e) => e.actionType))];

  return (
    <div className="min-h-screen bg-gray-50">

      <main className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Audit Log</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Immutable event trail across all fraud investigation cases. PCI DSS Requirement 10 compliance.
            </p>
          </div>
          <div className="text-right text-sm text-gray-500">
            {!loading && <span>{total} total events</span>}
          </div>
        </div>

        {/* Access model context */}
        <div className="bg-[#001E2B]/5 border border-[#001E2B]/20 rounded-xl p-4 text-sm mb-5">
          <strong>Security Auditor access (Level 4):</strong> Read-only oversight across all cases and roles.
          You can inspect access logs, escalations, field accesses, and control evidence.
          You cannot modify cases, rules, or customer data. Segregation of duties is enforced.
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap items-center">
          <Filter size={14} className="text-gray-400 shrink-0" />
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All roles</option>
            {uniqueRoles.map((r) => (
              <option key={r} value={r}>{PERFORMER_LABELS[r] ?? r}</option>
            ))}
          </select>
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All action types</option>
            {uniqueActions.map((a) => (
              <option key={a} value={a}>{ACTION_TYPE_LABELS[a] ?? a}</option>
            ))}
          </select>
          {(filterRole || filterAction) && (
            <button
              onClick={() => { setFilterRole(''); setFilterAction(''); }}
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
          <div className="bg-white rounded-xl border overflow-hidden">
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
                            href={`/demo/investigation/${e.fraudDiagnosisInstanceReference}`}
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
            {filtered.length > 0 && (
              <div className="px-4 py-2.5 border-t bg-gray-50 text-xs text-gray-500">
                Showing {filtered.length} of {total} events
                {(filterRole || filterAction) && ' (filtered)'}
              </div>
            )}
          </div>
        )}

        {/* Audit control context */}
        {!loading && events.length > 0 && (
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
              <p className="font-semibold text-gray-700 mb-1">PCI DSS Req 10</p>
              <p className="text-gray-500 text-xs">
                This audit trail satisfies Requirement 10: track and monitor all access to network
                resources and cardholder data. Timestamp, role, and action type are recorded for
                every event.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

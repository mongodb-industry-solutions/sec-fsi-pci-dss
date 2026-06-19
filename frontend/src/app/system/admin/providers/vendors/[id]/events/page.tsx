'use client';
import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useIntegration } from '../_context';
import { api } from '../../../../../../../lib/api';

interface IntegrationEvent {
  integrationEventInstanceReference: string;
  integrationEventType: string;
  integrationEventStatus: string;
  integrationEventLatencyMs?: number;
  integrationEventErrorMessage?: string;
  recordCreatedDateTime: string;
}

const STATUS_STYLE: Record<string, string> = {
  received:   'bg-green-100 text-green-700',
  sent:       'bg-blue-100 text-blue-700',
  timeout:    'bg-amber-100 text-amber-700',
  error:      'bg-red-100 text-red-700',
  skipped:    'bg-gray-100 text-gray-500',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-500';
  const Icon  = status === 'received' || status === 'sent' ? CheckCircle2
              : status === 'timeout'  ? Clock
              : status === 'error'    ? AlertCircle
              : null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${style}`}>
      {Icon && <Icon size={10} />}{status}
    </span>
  );
}

const PAGE_SIZE = 20;

export default function EventsPage() {
  const { integration, token } = useIntegration();
  const [events, setEvents]   = useState<IntegrationEvent[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const id = integration?.externalProviderArrangementInstanceReference ?? '';

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api.integrations.events(id, token, page, PAGE_SIZE)
      .then(r => {
        const d = r as unknown as { events: IntegrationEvent[]; total: number };
        setEvents(d.events ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => { setEvents([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [id, token, page]);

  useEffect(() => { load(); }, [load]);

  if (!integration) return null;

  const filtered = statusFilter
    ? events.filter(e => e.integrationEventStatus === statusFilter)
    : events;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const statuses   = Array.from(new Set(events.map(e => e.integrationEventStatus)));

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">All statuses</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-xs text-gray-400">{total} total event{total !== 1 ? 's' : ''}</span>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-300 hover:border-gray-500 text-gray-600 disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading events…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {total === 0 ? 'No events yet. Run a test from Overview to generate the first event.' : 'No events match the current filter.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Latency</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Error</th>
                <th className="text-right px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => {
                const eId = e.integrationEventInstanceReference;
                const isExpanded = expanded === eId;
                return [
                  <tr key={eId}
                    onClick={() => setExpanded(isExpanded ? null : eId)}
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-2.5 font-mono text-gray-700 text-xs">{e.integrationEventType}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={e.integrationEventStatus} /></td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-500 text-xs">
                      {e.integrationEventLatencyMs != null ? `${e.integrationEventLatencyMs}ms` : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-red-500 text-xs hidden sm:table-cell truncate max-w-[200px]">
                      {e.integrationEventErrorMessage || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400 text-xs whitespace-nowrap">
                      {new Date(e.recordCreatedDateTime).toLocaleString()}
                    </td>
                  </tr>,
                  isExpanded && (
                    <tr key={`${eId}-detail`} className="border-b bg-slate-50">
                      <td colSpan={5} className="px-4 py-3">
                        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div><dt className="text-gray-500">Event ID</dt><dd className="font-mono text-gray-700 break-all">{eId}</dd></div>
                          <div><dt className="text-gray-500">Type</dt><dd className="font-mono text-gray-700">{e.integrationEventType}</dd></div>
                          <div><dt className="text-gray-500">Status</dt><dd><StatusBadge status={e.integrationEventStatus} /></dd></div>
                          <div><dt className="text-gray-500">Latency</dt><dd className="font-mono">{e.integrationEventLatencyMs != null ? `${e.integrationEventLatencyMs}ms` : '-'}</dd></div>
                          {e.integrationEventErrorMessage && (
                            <div className="col-span-full">
                              <dt className="text-gray-500 mb-0.5">Error message</dt>
                              <dd className="text-red-600">{e.integrationEventErrorMessage}</dd>
                            </div>
                          )}
                        </dl>
                      </td>
                    </tr>
                  ),
                ].filter(Boolean);
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-2.5 py-1 rounded border hover:bg-gray-50 disabled:opacity-40">← Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-2.5 py-1 rounded border hover:bg-gray-50 disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

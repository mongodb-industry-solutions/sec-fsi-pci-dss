'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, AlertCircle, Clock, Download, Filter, Search, X,
  ArrowUpRight, ArrowDownLeft, ChevronDown, ChevronRight, Copy, Check,
} from 'lucide-react';
import { useIntegration } from '../_context';
import { api } from '../../../../../../../lib/api';
import { Pagination } from '../../../../../../../components/Pagination';
import { downloadJsonFile, appliedFilters } from '../../../../../../../lib/downloadJson';

/**
 * A provider's interaction log, as an audit reads it.
 *
 * It used to show type, status, latency, error and a timestamp, and nothing else. Everything an audit
 * of an external integration actually needs was already being recorded and none of it was reachable:
 * the request that was sent, the body that came back, and which DIRECTION the interaction went. The
 * last one matters most, because "are this provider's callbacks arriving at all" cannot be answered
 * from a list that interleaves what we sent with what we received and labels neither.
 *
 * So this mirrors the platform audit screen on purpose: same filters, same expandable detail, same
 * scoped JSON export. Someone who has learned to read one can read the other.
 */

interface IntegrationEvent {
  integrationEventInstanceReference: string;
  integrationEventType: string;
  integrationEventStatus: string;
  integrationEventLatencyMs?: number;
  integrationEventErrorMessage?: string;
  integrationEventResponseCode?: number;
  integrationEventTriggeredBy?: string;
  integrationEventPayloadHash?: string;
  integrationEventPayloadSnapshot?: Record<string, unknown>;
  integrationEventRequest?: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown };
  integrationEventResponse?: { status?: number; headers?: Record<string, string>; body?: unknown };
  integrationEventMeta?: Record<string, unknown>;
  businessContext?: Record<string, unknown>;
  recordCreatedDateTime: string;
  direction: 'outbound' | 'inbound';
}

const STATUS_STYLE: Record<string, string> = {
  received: 'bg-green-100 text-green-700',
  sent:     'bg-blue-100 text-blue-700',
  timeout:  'bg-amber-100 text-amber-700',
  error:    'bg-red-100 text-red-700',
  skipped:  'bg-gray-100 text-gray-500',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-500';
  const Icon = status === 'received' || status === 'sent' ? CheckCircle2
    : status === 'timeout' ? Clock
    : status === 'error' ? AlertCircle
    : null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${style}`}>
      {Icon && <Icon size={10} />}{status}
    </span>
  );
}

// Which way the data went, as the first thing on the row rather than something to infer from the type.
function DirectionBadge({ direction }: { direction: 'outbound' | 'inbound' }) {
  const outbound = direction === 'outbound';
  return (
    <span
      title={outbound ? 'Sent by this platform to the provider' : 'Received here from the provider'}
      className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${
        outbound ? 'bg-violet-100 text-violet-700' : 'bg-teal-100 text-teal-700'
      }`}
    >
      {outbound ? <ArrowUpRight size={10} /> : <ArrowDownLeft size={10} />}
      {outbound ? 'Sent' : 'Received'}
    </span>
  );
}

function CopyButton({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}{copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <dt className="text-gray-500 text-xs">{label}</dt>
        <CopyButton value={value} />
      </div>
      <pre className="bg-white border rounded-lg p-2 text-[11px] font-mono overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

const PAGE_SIZE = 20;
const EXPORT_PER_PAGE = 200;
const EXPORT_MAX = 5000;

export default function EventsPage() {
  const { integration, token } = useIntegration();
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [direction, setDirection] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');

  const id = integration?.externalProviderArrangementInstanceReference ?? '';
  const providerName = integration?.externalProviderArrangementName ?? id;

  // The filter set is built once and used by both the table and the export, so an extract can never
  // describe a narrower or wider scope than the screen it was taken from.
  const filters = {
    direction: direction || undefined,
    type: type || undefined,
    status: status || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
    q: q || undefined,
  };
  const hasFilters = !!(direction || type || status || from || to || q);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api.integrations.events(id, token, page, pageSize, filters)
      .then((r) => {
        const d = r as unknown as { events: IntegrationEvent[]; total: number };
        setEvents(d.events ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => { setEvents([]); setTotal(0); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token, page, pageSize, direction, type, status, from, to, q]);

  useEffect(() => { load(); }, [load]);

  /**
   * The events matching the CURRENT filters, as a self-describing JSON extract.
   *
   * Everything recorded, not the columns the table happens to show: the point of an evidence export
   * is that the reviewer can see the request and the response bodies without the screen in front of
   * them. Walks the pages rather than asking for one huge one, and says so when it truncates.
   */
  const downloadJson = useCallback(async () => {
    if (!id) return;
    setDownloading(true);
    try {
      const collected: IntegrationEvent[] = [];
      let pageN = 1;
      let grandTotal = 0;
      for (;;) {
        const res = await api.integrations.events(id, token, pageN, EXPORT_PER_PAGE, filters) as unknown as
          { events: IntegrationEvent[]; total: number };
        grandTotal = res.total;
        collected.push(...(res.events ?? []));
        if (collected.length >= res.total || (res.events ?? []).length < EXPORT_PER_PAGE || collected.length >= EXPORT_MAX) break;
        pageN += 1;
      }
      downloadJsonFile(`provider-events-${id}`, {
        generatedAt: new Date().toISOString(),
        provider: {
          reference: id,
          name: providerName,
          type: integration?.externalProviderArrangementType ?? null,
        },
        filtersApplied: appliedFilters(filters as Record<string, unknown>),
        totalMatching: grandTotal,
        exported: collected.length,
        truncated: collected.length < grandTotal,
        events: collected.map((e) => ({
          id: e.integrationEventInstanceReference,
          eventDateTime: e.recordCreatedDateTime,
          direction: e.direction,
          interaction: e.integrationEventType,
          outcome: e.integrationEventStatus,
          triggeredBy: e.integrationEventTriggeredBy ?? null,
          responseCode: e.integrationEventResponseCode ?? null,
          latencyMs: e.integrationEventLatencyMs ?? null,
          error: e.integrationEventErrorMessage ?? null,
          payloadHash: e.integrationEventPayloadHash ?? null,
          payload: e.integrationEventPayloadSnapshot ?? null,
          request: e.integrationEventRequest ?? null,
          response: e.integrationEventResponse ?? null,
          meta: e.integrationEventMeta ?? null,
          businessContext: e.businessContext ?? null,
        })),
      });
    } catch { /* surfaced by the absent download; non-blocking */ }
    finally { setDownloading(false); }
  }, [id, token, providerName, integration, filters]);

  if (!integration) return null;

  function applySearch() { setQ(qInput.trim()); setPage(1); }
  function clearFilters() {
    setDirection(''); setType(''); setStatus(''); setFrom(''); setTo(''); setQInput(''); setQ(''); setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Search + export */}
      <div className="bg-white rounded-xl border p-4 space-y-3">
        <div className="flex gap-2">
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
            placeholder="Search interaction, trigger, target URL, payload hash or error…"
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={applySearch}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold"
          >
            <Search size={14} /><span className="hidden sm:inline">Search</span>
          </button>
          <button
            onClick={downloadJson}
            disabled={downloading || loading}
            title="Download the events matching the current filters, with full request and response bodies"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Download size={14} />{downloading ? 'Preparing…' : 'Download JSON'}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <Filter size={14} className="text-gray-400 shrink-0" />
          <select
            value={direction}
            onChange={(e) => { setDirection(e.target.value); setPage(1); }}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">Both directions</option>
            <option value="outbound">Sent to provider</option>
            <option value="inbound">Received from provider</option>
          </select>
          <select
            value={type}
            onChange={(e) => { setType(e.target.value); setPage(1); }}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All interactions</option>
            <option value="dispatch">Dispatch</option>
            <option value="callback">Callback</option>
            <option value="test">Test</option>
            <option value="health_check">Health check</option>
          </select>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All outcomes</option>
            <option value="sent">Sent</option>
            <option value="received">Received</option>
            <option value="error">Error</option>
            <option value="timeout">Timeout</option>
          </select>
          <label className="text-xs text-gray-500 flex items-center gap-1">
            From
            <input type="datetime-local" value={from}
              onChange={(e) => { setFrom(e.target.value); setPage(1); }}
              className="border rounded-lg px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-gray-500 flex items-center gap-1">
            To
            <input type="datetime-local" value={to}
              onChange={(e) => { setTo(e.target.value); setPage(1); }}
              className="border rounded-lg px-2 py-1 text-sm" />
          </label>
          {hasFilters && (
            <button onClick={clearFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">
              <X size={13} />Clear
            </button>
          )}
          <span className="text-gray-400 text-sm ml-auto">
            {total} event{total !== 1 ? 's' : ''} match
          </span>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading events…</div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {hasFilters
            ? 'No events match the current filters.'
            : 'No events yet. Run a test from Outbound or Inbound to generate the first one.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="text-left px-4 py-3 font-medium w-8"></th>
                <th className="text-left px-4 py-3 font-medium">Direction</th>
                <th className="text-left px-4 py-3 font-medium">Interaction</th>
                <th className="text-left px-4 py-3 font-medium">Outcome</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Target</th>
                <th className="text-right px-4 py-3 font-medium">Latency</th>
                <th className="text-right px-4 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const eId = e.integrationEventInstanceReference;
                const isExpanded = expanded === eId;
                return [
                  <tr key={eId}
                    onClick={() => setExpanded(isExpanded ? null : eId)}
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-2.5 text-gray-400">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="px-4 py-2.5"><DirectionBadge direction={e.direction} /></td>
                    <td className="px-4 py-2.5 font-mono text-gray-700 text-xs">{e.integrationEventType}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={e.integrationEventStatus} />
                      {e.integrationEventResponseCode != null && (
                        <span className="ml-1.5 text-[11px] text-gray-500 font-mono">HTTP {e.integrationEventResponseCode}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 font-mono hidden lg:table-cell truncate max-w-[260px]">
                      {e.integrationEventRequest?.url ?? '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-500 text-xs">
                      {e.integrationEventLatencyMs != null ? `${e.integrationEventLatencyMs}ms` : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400 text-xs whitespace-nowrap">
                      {new Date(e.recordCreatedDateTime).toLocaleString()}
                    </td>
                  </tr>,
                  isExpanded && (
                    <tr key={`${eId}-detail`} className="border-b bg-slate-50">
                      <td colSpan={7} className="px-4 py-3 space-y-3">
                        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div><dt className="text-gray-500">Event ID</dt><dd className="font-mono text-gray-700 break-all">{eId}</dd></div>
                          <div><dt className="text-gray-500">Triggered by</dt><dd className="font-mono text-gray-700 break-all">{e.integrationEventTriggeredBy ?? '-'}</dd></div>
                          <div><dt className="text-gray-500">Payload hash</dt><dd className="font-mono text-gray-700 break-all">{e.integrationEventPayloadHash ?? '-'}</dd></div>
                          <div><dt className="text-gray-500">Latency</dt><dd className="font-mono">{e.integrationEventLatencyMs != null ? `${e.integrationEventLatencyMs}ms` : '-'}</dd></div>
                        </dl>
                        {e.integrationEventErrorMessage && (
                          <div>
                            <dt className="text-gray-500 text-xs mb-0.5">Error</dt>
                            <dd className="text-red-600 text-xs font-mono break-all">{e.integrationEventErrorMessage}</dd>
                          </div>
                        )}
                        {/* What was sent and what came back, side by side: the pair is the evidence,
                            and reading one without the other answers half the question. */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <JsonBlock
                            label={e.direction === 'outbound' ? 'Request sent' : 'Request received'}
                            value={e.integrationEventRequest}
                          />
                          <JsonBlock label="Response" value={e.integrationEventResponse} />
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          <JsonBlock label="Payload (sanitized)" value={e.integrationEventPayloadSnapshot} />
                          <JsonBlock label="Business context" value={e.businessContext} />
                        </div>
                        <JsonBlock label="Meta" value={e.integrationEventMeta} />
                      </td>
                    </tr>
                  ),
                ].filter(Boolean);
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        limit={pageSize}
        onPageChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        onLimitChange={(l) => { setPageSize(l); setPage(1); }}
        limitOptions={[20, 50, 100]}
        noun="events"
      />
    </div>
  );
}

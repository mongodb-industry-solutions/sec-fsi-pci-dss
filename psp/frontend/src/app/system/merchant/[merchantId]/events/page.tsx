'use client';
import { useEffect, useState, useCallback } from 'react';
import { Activity, ChevronDown, ChevronRight, Check, RefreshCw } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Pagination } from '../../../../../components/Pagination';
import { useRequireActiveMerchant } from '../../../../../lib/merchantContext';
import { useDebugMode } from '../../../../../lib/debugMode';
import { api, type WebhookDeliveryLog, type WebhookEventType, WEBHOOK_EVENT_LABELS } from '../../../../../lib/api';
import { JsonView } from '../../../../../components/json/JsonView';

const ALL_EVENT_TYPES: WebhookEventType[] = [
  'payment.completed',
  'payment.failed',
  'oauth.authorization_granted',
  'oauth.authorization_revoked',
  'user.notification',
  'dispute.opened',
  'kyb.status_changed',
  // OAuth event callbacks appear in /system/merchant/sso but remain filterable here
];

const LIMIT_OPTIONS = [10, 25, 50];

function formatTs(ts: string) {
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
  } catch {
    return ts;
  }
}

function LogRow({ log }: { log: WebhookDeliveryLog }) {
  const [open, setOpen] = useState(false);
  const { debugMode } = useDebugMode();

  return (
    <div className={`border rounded-xl overflow-hidden ${log.delivered ? 'border-gray-200' : 'border-red-200'}`}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${log.delivered ? 'bg-green-500' : 'bg-red-500'}`} />
        <div className="flex-1 min-w-0 grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center">
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${log.deliveryType === 'test' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
            {log.deliveryType}
          </span>
          <span className="text-sm text-gray-700 truncate">{WEBHOOK_EVENT_LABELS[log.webhookEventType] ?? log.webhookEventType}</span>
          {log.responseStatus && (
            <span className={`text-xs font-mono ${log.delivered ? 'text-green-700' : 'text-red-600'}`}>HTTP {log.responseStatus}</span>
          )}
          <span className="text-xs text-gray-400 shrink-0">{formatTs(log.deliveredAt)}</span>
        </div>
        {open ? <ChevronDown size={14} className="text-gray-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 pb-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Status</p>
              <p className={`text-sm font-medium ${log.delivered ? 'text-green-700' : 'text-red-600'}`}>
                {log.delivered ? 'Delivered' : 'Failed'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Attempts</p>
              <p className="text-sm text-gray-700">{log.attempts}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">Response</p>
              <p className="text-sm text-gray-700">{log.responseStatus ? `HTTP ${log.responseStatus}` : 'No response'}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">URL</p>
              <p className="text-xs text-gray-600 font-mono truncate">{log.requestUrl}</p>
            </div>
          </div>

          {log.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-xs text-red-700">{log.error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1.5">Request headers</p>
              <JsonView data={log.requestHeaders} maxHeight="10rem" collapsed={1} />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1.5">Request body</p>
              <JsonView data={log.requestBody} maxHeight="10rem" collapsed={2} />
            </div>
          </div>

          {log.responseBody !== undefined && log.responseBody !== null && (
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1.5">Response body</p>
              <JsonView data={log.responseBody} maxHeight="10rem" collapsed={2} />
            </div>
          )}

          {debugMode && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-500 mb-1">Signature</p>
              <p className="font-mono text-[11px] text-gray-500 break-all">{log.signature}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">logId: {log.logId}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MerchantEventsPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';
  const [logs, setLogs] = useState<WebhookDeliveryLog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterEventType, setFilterEventType] = useState<WebhookEventType | ''>('');
  const [filterDeliveryType, setFilterDeliveryType] = useState<'live' | 'test' | ''>('');
  const [filterDelivered, setFilterDelivered] = useState<'all' | 'yes' | 'no'>('all');

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const reload = useCallback(async () => {
    if (!merchantId || !token) return;
    setLoading(true);
    try {
      const r = await api.merchants.listDeliveryLogs(
        merchantId,
        token,
        {
          eventType: filterEventType || undefined,
          deliveryType: filterDeliveryType || undefined,
          delivered: filterDelivered === 'all' ? undefined : filterDelivered === 'yes',
        },
        { page, limit },
      );
      setLogs(r.logs);
      setTotal(r.total);
      setTotalPages(r.totalPages);
    } catch { /* ignore */ }
    setLoading(false);
  }, [merchantId, token, filterEventType, filterDeliveryType, filterDelivered, page, limit]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [filterEventType, filterDeliveryType, filterDelivered, limit]);

  useEffect(() => { reload(); }, [reload]);

  if (!merchant) return null;

  const successCount = logs.filter((l) => l.delivered).length;
  const failCount = logs.filter((l) => !l.delivered).length;

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <SectionHeader
          icon={Activity}
          title="Webhook Events"
          description="Delivery log for all outbound webhook attempts, live and test."
          debugInfo="BQ:Notification, ADR-038, PCI DSS"
        />
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors shrink-0 mt-1"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <select
            value={filterEventType}
            onChange={(e) => setFilterEventType(e.target.value as WebhookEventType | '')}
            className="appearance-none border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 cursor-pointer"
          >
            <option value="">All event types</option>
            {ALL_EVENT_TYPES.map((t) => <option key={t} value={t}>{WEBHOOK_EVENT_LABELS[t]}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={filterDeliveryType}
            onChange={(e) => setFilterDeliveryType(e.target.value as 'live' | 'test' | '')}
            className="appearance-none border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 cursor-pointer"
          >
            <option value="">Live and test</option>
            <option value="live">Live only</option>
            <option value="test">Test only</option>
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={filterDelivered}
            onChange={(e) => setFilterDelivered(e.target.value as 'all' | 'yes' | 'no')}
            className="appearance-none border border-gray-300 rounded-lg pl-3 pr-8 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40 cursor-pointer"
          >
            <option value="all">All statuses</option>
            <option value="yes">Delivered</option>
            <option value="no">Failed</option>
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        {!loading && total > 0 && (
          <span className="text-xs text-gray-400 flex items-center gap-2 ml-auto">
            {successCount > 0 && <span className="text-green-700 flex items-center gap-1"><Check size={11} /> {successCount} delivered</span>}
            {failCount > 0 && <span className="text-red-600">{failCount} failed</span>}
          </span>
        )}
      </div>

      {/* Log list */}
      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-14 text-gray-400">
          <Activity size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No delivery events yet.</p>
          <p className="text-xs mt-1">Send a test from the Webhook page to see activity here.</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {logs.map((log) => <LogRow key={log.logId} log={log} />)}
          </div>
          <div className="border-t border-gray-100 pt-4">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={(l) => setLimit(l)}
              limitOptions={LIMIT_OPTIONS}
              noun="events"
            />
          </div>
        </>
      )}
    </div>
  );
}

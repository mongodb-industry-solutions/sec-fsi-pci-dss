'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ListChecks, Search, RefreshCw, ExternalLink } from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { Pagination } from '../../../../../components/Pagination';
import { useRequireActiveMerchant } from '../../../../../lib/merchantContext';
import { api } from '../../../../../lib/api';

// v18 B-04/B-05/B-12: "user × merchant × action" activity view (display-safe). Merchant is the
// route context; user + free-text + date range are filters, with standard pagination.
type ActivityRow = {
  id: string;
  eventDateTime: string;
  processType: string;
  processAction: string;
  processOutcome: string;
  entityType: string;
  entityId: string;
  clientId?: string;
  actingPartyReference?: string;
  actingUserName?: string;
  actingChannel?: string;
  summary?: Record<string, unknown>;
};

const LIMIT_OPTIONS = [10, 25, 50];

// Turn a machine action id (e.g. "oauth.consent.granted") into a human-readable label.
function humanizeAction(action: string): string {
  return action
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Friendly label for the acting channel.
const CHANNEL_LABELS: Record<string, string> = {
  oauth_merchant: "Merchant app (SSO)",
  session: "Direct session",
};

const OUTCOME_STYLES: Record<string, string> = {
  approved: 'bg-green-100 text-green-700', received: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700', failed: 'bg-red-100 text-red-700', error: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
};

// Link an activity row to the operation it relates to when a transaction/execution id is present.
function operationHref(row: ActivityRow): string | null {
  if (row.entityType === 'transaction' && row.entityId) return `/system/payment/history/${row.entityId}`;
  return null;
}

export default function MerchantActivityPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters: user (party ref), free text, date range.
  // Ignore stale/empty values (a legacy "?user=undefined" must not filter everything out).
  const initialUser = searchParams.get('user') ?? '';
  const [userFilter, setUserFilter] = useState(initialUser === 'undefined' || initialUser === 'null' ? '' : initialUser);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const reload = useCallback(async () => {
    if (!merchantId || !token) return;
    setLoading(true);
    try {
      const r = await api.merchants.activity(
        merchantId,
        {
          user: userFilter || undefined,
          q: q || undefined,
          dateFrom: from ? new Date(from).toISOString() : undefined,
          dateTo: to ? new Date(to).toISOString() : undefined,
          page, limit,
        },
        token,
      );
      setRows(r.events);
      setTotal(r.total);
    } catch { setRows([]); setTotal(0); }
    setLoading(false);
  }, [merchantId, token, userFilter, q, from, to, page, limit]);

  useEffect(() => { setPage(1); }, [userFilter, q, from, to, limit]);
  useEffect(() => { reload(); }, [reload]);

  if (!merchant) return null;

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = userFilter || q || from || to;

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5">
      <SectionHeader
        icon={ListChecks}
        title="Activity"
        description="Who did what through this merchant: actions attributed to the merchant's app (SSO)."
        debugInfo="businessProcessEvent (audit) · attribution merchantAgreementReference/actingPartyReference · PCI DSS"
      />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="lg:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Action, entity id or user…"
              className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
        </div>
        <div className="lg:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">User (party reference)</label>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={userFilter} onChange={(e) => setUserFilter(e.target.value)}
              placeholder="Filter by acting user (party ref)…"
              className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div className="flex items-end gap-2 lg:col-span-2">
          {hasFilters && (
            <button onClick={() => { setUserFilter(''); setQ(''); setFrom(''); setTo(''); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Clear</button>
          )}
          <button onClick={reload}
            className="text-xs px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors inline-flex items-center gap-1">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">
            <ListChecks size={30} className="mx-auto mb-3 opacity-30" />
            No activity matches the current filters.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((row) => {
              const href = operationHref(row);
              return (
                <li key={row.id} className="px-5 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-[#001E2B] font-semibold break-words" title={row.processAction}>{humanizeAction(row.processAction)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OUTCOME_STYLES[row.processOutcome] ?? 'bg-gray-100 text-gray-600'}`}>{row.processOutcome}</span>
                      <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{humanizeAction(row.processType)}</span>
                      {row.actingChannel && (
                        <span className="text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">{CHANNEL_LABELS[row.actingChannel] ?? row.actingChannel}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {(row.actingUserName || row.actingPartyReference) && (
                        <>by <span className="font-medium text-gray-600">{row.actingUserName || `${row.actingPartyReference!.slice(0, 16)}…`}</span></>
                      )}
                      {row.entityId && <> · {row.entityType} <span className="font-mono">{row.entityId.slice(0, 16)}…</span></>}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 shrink-0 tabular-nums">{new Date(row.eventDateTime).toLocaleString()}</div>
                  {href && (
                    <Link href={href} title="Open related operation"
                      className="shrink-0 inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline">
                      Open <ExternalLink size={12} />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!loading && rows.length > 0 && (
          <div className="px-3 py-2 border-t border-gray-100">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={(l) => { setLimit(l); setPage(1); }}
              limitOptions={LIMIT_OPTIONS}
              noun="events"
            />
          </div>
        )}
      </div>
    </div>
  );
}

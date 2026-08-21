'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronRight, HelpCircle, ShieldCheck, Search, CheckCheck, Mail, MessageSquare, UserCheck, Building2 } from 'lucide-react';
import { api, type NotificationItem } from '../../../lib/api';
import { getToken } from '../../../lib/auth';
import { SectionHeader } from '../../../components/SectionHeader';
import { Pagination } from '../../../components/Pagination';
import { emitNotificationsChanged, useNotificationsChanged } from '../../../lib/useNotificationsStream';

const PAGE_SIZE = 10;

// Each notification type is a category (shown as a chip + used by the category filter).
const TYPE_META: Record<string, { label: string; icon: typeof Bell; tone: string; chip: string }> = {
  fraud_question:     { label: 'Question',    icon: HelpCircle,    tone: 'bg-amber-50 text-amber-600',  chip: 'bg-amber-100 text-amber-700' },
  security_message:   { label: 'Message',     icon: Mail,          tone: 'bg-blue-50 text-blue-600',    chip: 'bg-blue-100 text-blue-700' },
  transaction_status: { label: 'Transaction', icon: ShieldCheck,   tone: 'bg-indigo-50 text-indigo-600', chip: 'bg-indigo-100 text-indigo-700' },
  kyc_status:         { label: 'KYC',         icon: UserCheck,     tone: 'bg-teal-50 text-teal-600',    chip: 'bg-teal-100 text-teal-700' },
  kyb_status:         { label: 'KYB',         icon: Building2,     tone: 'bg-purple-50 text-purple-600', chip: 'bg-purple-100 text-purple-700' },
  question_response:  { label: 'Response',    icon: MessageSquare, tone: 'bg-green-50 text-green-600',  chip: 'bg-green-100 text-green-700' },
};

// ADR-031: full notifications list (read + unread) with search + type/status filter + pagination.
// Clicking a notification marks it read (immutable history is kept). Scoped to the caller .
export default function NotificationsPage() {
  const [token, setToken] = useState('');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => { setToken(getToken() ?? ''); }, []);

  const load = useCallback(() => {
    if (!token) { setLoading(false); return; }
    api.notifications.list(token).then((r) => setItems(r.items)).catch(() => setItems([])).finally(() => setLoading(false));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useNotificationsChanged(load); // refresh if the bell (or another view) marks items read

  const unread = items.filter((n) => n.status === 'unread').length;

  async function readOne(n: NotificationItem) {
    if (n.status !== 'unread') return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, status: 'read' } : x)));
    // Await the write BEFORE signalling so the bell + sidebar badges refetch the post-write count and
    // both decrement together (they show the same data and must stay synchronized).
    await api.notifications.markRead(n.id, token).catch(() => { /* ignore */ });
    emitNotificationsChanged();
  }
  async function readAll() {
    setItems((prev) => prev.map((x) => ({ ...x, status: 'read' })));
    await api.notifications.markAllRead(token).catch(() => { /* ignore */ });
    emitNotificationsChanged();
  }

  // One-click filter to a case or transaction: clicking the reference on a notification narrows the
  // list to every notification associated with it (the search already matches case ref + txn id).
  function filterByRef(ref: string) { setQ(ref); setPage(1); }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((n) => {
      if (typeFilter && n.type !== typeFilter) return false;
      if (statusFilter && n.status !== statusFilter) return false;
      if (!term) return true;
      // Search matches title/detail/case ref AND the transaction id (paste a txn id to filter to it).
      return n.title.toLowerCase().includes(term)
        || n.detail.toLowerCase().includes(term)
        || (n.caseReference ?? '').toLowerCase().includes(term)
        || (n.transactionId ?? '').toLowerCase().includes(term);
    });
  }, [items, q, typeFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Bell}
        title="Notifications"
        description="Items that need your attention and updates on your transactions."
        debugInfo="ADR-031 · PCI DSS (own-data) / (traceable)"
        actions={unread > 0 ? (
          <button onClick={readAll} className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium">
            <CheckCheck size={14} /> Mark all read
          </button>
        ) : undefined}
      />

      {/* Search + type + status filters; standard pattern */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search (text, case ref, or transaction id)…" className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">All categories</option>
          <option value="transaction_status">Transactions</option>
          <option value="kyc_status">KYC</option>
          <option value="kyb_status">KYB</option>
          <option value="fraud_question">Questions</option>
          <option value="security_message">Messages</option>
          <option value="question_response">Responses</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">
          {items.length === 0 ? 'You have no notifications.' : 'No notifications match your filters.'}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {paged.map((n) => {
              const meta = TYPE_META[n.type] ?? { label: n.type, icon: Bell, tone: 'bg-gray-100 text-gray-500', chip: 'bg-gray-100 text-gray-600' };
              const Icon = meta.icon;
              const isUnread = n.status === 'unread';
              return (
                <Link key={n.id} href={n.href ?? '/system/notifications'} onClick={() => readOne(n)}
                  className={`group flex items-start gap-3 rounded-xl border p-4 transition-all hover:shadow-md ${
                    isUnread ? 'bg-white border-[#00ED64]/40' : 'bg-gray-50 border-gray-200'
                  }`}>
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.tone} ${isUnread ? '' : 'opacity-70'}`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-[#00ED64] shrink-0" />}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${meta.chip}`}>{meta.label}</span>
                      <p className={`text-sm ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-600'}`}>{n.title}</p>
                      {n.actionable && isUnread && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#00ED64]/15 text-[#007a4d] font-medium">Action needed</span>}
                    </div>
                    <p className={`text-sm mt-0.5 ${isUnread ? 'text-gray-600' : 'text-gray-500'}`}>{n.detail}</p>
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-400 mt-1 font-mono">
                      {/* Clickable references: filter the list to this case / transaction */}
                      {n.caseReference && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); filterByRef(n.caseReference as string); }}
                          className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-[#00ED64]/20 hover:text-[#007a4d] transition-colors"
                          title="Filter to this case"
                        >
                          {n.caseReference}
                        </button>
                      )}
                      {n.transactionId && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); filterByRef(n.transactionId as string); }}
                          className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-[#00ED64]/20 hover:text-[#007a4d] transition-colors"
                          title="Filter to this transaction"
                        >
                          txn {n.transactionId.slice(0, 8)}…
                        </button>
                      )}
                      <span>{new Date(n.createdAt).toLocaleString()}</span>
                      {!isUnread && <span>· read</span>}
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-gray-300 group-hover:text-[#001E2B] mt-1 shrink-0" />
                </Link>
              );
            })}
          </div>
          <Pagination page={safePage} totalPages={totalPages} total={filtered.length} limit={PAGE_SIZE} onPageChange={setPage} noun="notifications" />
        </>
      )}
    </div>
  );
}

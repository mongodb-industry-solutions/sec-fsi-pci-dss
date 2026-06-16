'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronRight, HelpCircle, ShieldCheck, Search } from 'lucide-react';
import { api, type NotificationItem } from '../../../lib/api';
import { getToken } from '../../../lib/auth';
import { SectionHeader } from '../../../components/SectionHeader';
import { Pagination } from '../../../components/Pagination';

const PAGE_SIZE = 10;

const TYPE_META: Record<string, { label: string; icon: typeof Bell; tone: string }> = {
  fraud_question:     { label: 'Action needed',  icon: HelpCircle,  tone: 'bg-amber-50 text-amber-600' },
  transaction_status: { label: 'Status update',  icon: ShieldCheck, tone: 'bg-blue-50 text-blue-600' },
};

// ADR-031: full notifications list with standard search + type filter + pagination. The full message
// is shown here (the top-bar dropdown truncates it). Scoped server-side to the caller (PCI DSS Req 7).
export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = getToken() ?? '';
    if (!t) { setLoading(false); return; }
    api.notifications.list(t).then((r) => setItems(r.items)).catch(() => setItems([])).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((n) => {
      if (typeFilter && n.type !== typeFilter) return false;
      if (!term) return true;
      return n.title.toLowerCase().includes(term) || n.detail.toLowerCase().includes(term) || n.caseReference.toLowerCase().includes(term);
    });
  }, [items, q, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Bell}
        title="Notifications"
        description="Items that need your attention and updates on your transactions."
        debugInfo="ADR-031 · BIAN SD-83 · PCI DSS Req 7 (own-data) / Req 10 (traceable)"
      />

      {/* Search + type filter; standard pattern */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search notifications…" className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm" />
        </div>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">All types</option>
          <option value="fraud_question">Action needed</option>
          <option value="transaction_status">Status updates</option>
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
              const meta = TYPE_META[n.type] ?? { label: n.type, icon: Bell, tone: 'bg-gray-100 text-gray-500' };
              const Icon = meta.icon;
              return (
                <Link key={n.id} href={n.href}
                  className="group flex items-start gap-3 bg-white rounded-xl border p-4 hover:border-[#001E2B]/30 hover:shadow-md transition-all">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.tone}`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900">{n.title}</p>
                      {n.actionable && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#00ED64]/15 text-[#007a4d] font-medium">Action needed</span>}
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">{n.detail}</p>
                    <p className="text-[11px] text-gray-400 mt-1 font-mono">{n.caseReference} · {new Date(n.createdAt).toLocaleString()}</p>
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

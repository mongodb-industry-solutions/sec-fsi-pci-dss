'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronRight } from 'lucide-react';
import { api, type NotificationItem } from '../../../lib/api';
import { getToken } from '../../../lib/auth';
import { SectionHeader } from '../../../components/SectionHeader';

// ADR-031: pending actionable items for the signed-in user (currently unanswered security questions).
export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = getToken() ?? '';
    if (!t) { setLoading(false); return; }
    api.notifications.list(t).then((r) => setItems(r.items)).catch(() => setItems([])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Bell}
        title="Notifications"
        description="Pending items that need your attention."
        debugInfo="ADR-031 · BIAN SD-83 · PCI DSS Req 10"
      />
      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border p-6 text-center text-sm text-gray-500">You have no pending notifications.</div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <Link key={n.id} href={n.href}
              className="group flex items-start gap-3 bg-white rounded-xl border p-4 hover:border-[#001E2B]/30 hover:shadow-md transition-all">
              <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                <Bell size={16} className="text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">{n.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{n.detail}</p>
                <p className="text-[11px] text-gray-400 mt-1 font-mono">{n.caseReference} · {new Date(n.createdAt).toLocaleString()}</p>
              </div>
              <ChevronRight size={16} className="text-gray-300 group-hover:text-[#001E2B] mt-1 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

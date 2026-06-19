'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { api, type NotificationItem } from '../lib/api';
import { getToken } from '../lib/auth';
import { useNotificationsStream, useNotificationsChanged, emitNotificationsChanged } from '../lib/useNotificationsStream';

// ADR-031: top-bar notifications. Dark dropdown matching the adjacent user menu. Shows an unread
// (actionable) count badge; lists the latest 5 with a one-line (truncated) message and a "View all"
// link. Updates live via SSE so new questions / answered items appear without a refresh.
export function NotificationBell() {
  const [token, setToken] = useState('');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setToken(getToken() ?? ''); }, []);

  const load = useCallback(() => {
    if (!token) return;
    api.notifications.list(token).then((r) => { setItems(r.items); setCount(r.count); }).catch(() => { /* ignore */ });
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useNotificationsStream(token, load);   // live refresh on change (SSE)
  useNotificationsChanged(load);         // instant same-tab refresh when the page marks items read

  async function readOne(n: NotificationItem) {
    setOpen(false);
    if (n.status !== 'unread') return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, status: 'read' } : x)));
    setCount((c) => Math.max(0, c - 1));
    // Await the write BEFORE signalling, so the sidebar/page refetch the post-write count (not the
    // stale one) and both badges decrement in lock-step.
    await api.notifications.markRead(n.id, token).catch(() => { /* ignore */ });
    emitNotificationsChanged();
  }

  async function readAll() {
    setItems((prev) => prev.map((x) => ({ ...x, status: 'read' })));
    setCount(0);
    await api.notifications.markAllRead(token).catch(() => { /* ignore */ });
    emitNotificationsChanged();
  }

  useEffect(() => {
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, []);

  const top5 = items.slice(0, 5);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        aria-expanded={open}
        className={`relative flex items-center justify-center w-9 h-9 rounded-lg border transition-all duration-150 ${
          open ? 'bg-white/10 border-white/20 text-white' : 'border-transparent text-gray-300 hover:bg-white/8 hover:border-white/10 hover:text-white'
        }`}
      >
        <Bell size={17} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#00ED64] text-[#001E2B] text-[10px] font-bold flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] rounded-xl border border-white/10 bg-[#0d2a38] shadow-2xl shadow-black/40 overflow-hidden z-50">
          <div className="px-4 py-3 flex items-center justify-between border-b border-white/8">
            <p className="text-white text-sm font-semibold">Notifications</p>
            {count > 0
              ? <button onClick={readAll} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#00ED64]/15 text-[#00ED64] font-medium border border-[#00ED64]/30 hover:bg-[#00ED64]/25 transition-colors">Mark all read</button>
              : <span className="text-[10px] text-gray-500">No new</span>}
          </div>

          {top5.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">You&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-white/5">
              {top5.map((n) => (
                <li key={n.id}>
                  <Link href={n.href} role="menuitem" onClick={() => readOne(n)}
                    className={`block px-4 py-2.5 hover:bg-white/8 transition-colors ${n.status === 'read' ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${n.status === 'unread' ? (n.actionable ? 'bg-[#00ED64]' : 'bg-sky-400') : 'bg-gray-600'}`} />
                      <p className={`text-sm truncate ${n.status === 'unread' ? 'font-semibold text-gray-100' : 'font-medium text-gray-300'}`}>{n.title}</p>
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5 pl-3.5">{n.detail}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Link href="/system/notifications" role="menuitem" onClick={() => setOpen(false)}
            className="block px-4 py-2.5 border-t border-white/8 text-center text-sm font-medium text-[#00ED64] hover:bg-white/8 transition-colors">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

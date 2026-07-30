'use client';
// Classic top-right profile dropdown: avatar → user identity + Profile / Help / Logout.
// Click-outside + Escape to close; keyboard accessible.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, CircleUserRound, ExternalLink, HelpCircle, Home, LayoutDashboard, LogOut, Store } from 'lucide-react';
import { BRAND } from '@/lib/brand';

export interface ProfileUser {
  name: string;
  email?: string;
  merchant: string;
}

/** Browser-facing PSP pages, resolved server-side from ENV (cross-origin, so plain anchors). */
export interface PspLinks {
  portal: string;
  dashboard: string;
}

export default function ProfileMenu({ user, pspLinks }: { user: ProfileUser; pspLinks: PspLinks }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Never render the literal string "undefined": fall back to the email local-part, then "Account".
  const localPart = user.email?.includes('@') ? user.email.split('@')[0] : user.email;
  const displayName = user.name?.trim() || localPart?.trim() || 'Account';
  const initials = displayName.slice(0, 1).toUpperCase() || 'U';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-white/90 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-leaf font-semibold text-leaf-ink">{initials}</span>
        <span className="hidden max-w-[9rem] truncate text-sm sm:block">{displayName}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="glass absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl text-ink [animation:tt-in_120ms_ease-out]"
        >
          <div className="flex items-center gap-3 border-b border-line bg-surface-alt px-4 py-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-leaf font-semibold text-leaf-ink">{initials}</span>
            <div className="min-w-0">
              <p className="truncate font-medium">{displayName}</p>
              {user.email && <p className="truncate text-xs text-muted">{user.email}</p>}
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                <Store className="h-3 w-3" aria-hidden /> {user.merchant}
              </p>
            </div>
          </div>
          <nav className="py-1 text-sm">
            <Link href="/profile" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2 hover:bg-surface-alt">
              <CircleUserRound className="h-4 w-4 text-muted" aria-hidden /> Profile &amp; permissions
            </Link>
            <Link href="/help" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2 hover:bg-surface-alt">
              <HelpCircle className="h-4 w-4 text-muted" aria-hidden /> Help
            </Link>
            <a
              href={pspLinks.dashboard}
              role="menuitem"
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 border-t border-line px-4 py-2 hover:bg-surface-alt"
            >
              <LayoutDashboard className="h-4 w-4 text-muted" aria-hidden /> {BRAND.full} dashboard
              <ExternalLink className="ml-auto h-3 w-3 text-muted" aria-hidden />
            </a>
            <a
              href={pspLinks.portal}
              role="menuitem"
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2 hover:bg-surface-alt"
            >
              <Home className="h-4 w-4 text-muted" aria-hidden /> PSP portal
              <ExternalLink className="ml-auto h-3 w-3 text-muted" aria-hidden />
            </a>
            <a href="/api/auth/logout" role="menuitem" className="flex items-center gap-2.5 border-t border-line px-4 py-2 text-[var(--err)] hover:bg-[var(--err-bg)]">
              <LogOut className="h-4 w-4" aria-hidden /> Log out
            </a>
          </nav>
        </div>
      )}
    </div>
  );
}

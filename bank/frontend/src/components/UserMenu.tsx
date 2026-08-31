'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown, CreditCard, FileClock, Home, KeyRound, Landmark, LogOut, ScrollText, Users,
} from 'lucide-react';

/**
 * The signed-in person, and everything they can reach, in the header.
 *
 * Same shape as the provider's menu so the platform reads as one product. What differs is the
 * destinations, which are this bank's, and one that is not: credentials are managed at the identity
 * authority, because that is where they live.
 */

interface Session {
  signedIn: boolean;
  userName?: string;
  roles?: string[];
}

const AUTHORITY_UI = process.env.NEXT_PUBLIC_BANKCORE_AUTHORITY_URL ?? 'http://localhost:8086';

// One colour per bank role. A role with no entry falls back rather than rendering an empty circle.
const ROLE_AVATAR: Record<string, string> = {
  bank_admin: 'bg-slate-600',
  bank_operations: 'bg-teal-600',
  bank_card_officer: 'bg-orange-600',
  bank_compliance: 'bg-purple-600',
  bank_customer: 'bg-blue-600',
};

const ROLE_LABEL: Record<string, string> = {
  bank_admin: 'Administrator',
  bank_operations: 'Operations',
  bank_card_officer: 'Card Officer',
  bank_compliance: 'Compliance',
  bank_customer: 'Account Holder',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const ITEMS: Array<{ href: string; label: string; icon: typeof Home; external?: boolean }> = [
  { href: '/', label: 'Bank home', icon: Home },
  { href: '/accounts', label: 'Accounts', icon: Landmark },
  { href: '/cards', label: 'Card estate', icon: CreditCard },
  { href: '/holders', label: 'Parties', icon: Users },
  { href: '/records/audit', label: 'Audit records', icon: ScrollText },
  { href: '/records/tpp/registrations', label: 'Third-party registrations', icon: FileClock },
];

export function UserMenu() {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then(setSession)
      .catch(() => setSession({ signedIn: false }));
  }, []);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!session?.signedIn) return null;

  const name = session.userName ?? 'Signed in';
  const role = session.roles?.[0] ?? '';
  const avatar = ROLE_AVATAR[role] ?? 'bg-gray-600';

  async function signOut() {
    setOpen(false);
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/');
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((visible) => !visible)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-2 rounded-lg border py-1 pl-1 pr-2 transition-all ${
          open ? 'border-white/20 bg-white/10' : 'border-transparent hover:border-white/10 hover:bg-white/10'
        }`}
      >
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatar}`}>
          {initials(name)}
        </span>
        <span className="hidden flex-col items-start leading-none sm:flex">
          <span className="max-w-32 truncate text-xs font-semibold text-bank-ink">{name}</span>
          <span className="max-w-32 truncate text-[10px] font-medium text-bank-ink/70">
            {ROLE_LABEL[role] ?? role}
          </span>
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-bank-ink/70 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          // Full width on a phone, anchored to the trigger from `sm` up: a 256px panel pinned to the
          // right edge of a 380px screen goes off it.
          className="fixed inset-x-2 top-14 z-50 w-auto overflow-hidden rounded-xl border border-white/10 bg-[#0b3d5c] shadow-2xl shadow-black/40 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-64"
        >
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatar}`}>
              {initials(name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{name}</p>
              <span className="mt-0.5 inline-block rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/80">
                {ROLE_LABEL[role] ?? (role || 'no role')}
              </span>
            </div>
          </div>

          <div className="py-1.5">
            {ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-white/85 transition-colors hover:bg-white/10 hover:text-white"
              >
                <item.icon size={15} className="shrink-0 text-white/60" />
                <span>{item.label}</span>
              </Link>
            ))}

            <div className="mx-3 my-1 border-t border-white/10" />

            <a
              href={`${AUTHORITY_UI}/profile/credentials`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-white/85 transition-colors hover:bg-white/10 hover:text-white"
            >
              <KeyRound size={15} className="shrink-0 text-white/60" />
              <span>Your credentials</span>
            </a>

            <div className="mx-3 my-1 border-t border-white/10" />

            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-white/85 transition-colors hover:bg-red-500/20 hover:text-red-200"
            >
              <LogOut size={15} className="shrink-0 text-white/60" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

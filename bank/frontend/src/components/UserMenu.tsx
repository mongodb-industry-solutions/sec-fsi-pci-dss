'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bug, ChevronDown, CreditCard, FileClock, Globe2, Home, KeyRound, Laptop, Landmark, LifeBuoy, LogOut,
  ScrollText, Users,
} from 'lucide-react';
import { useDebugMode } from '../lib/debugMode';

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

export function UserMenu({ authorityUi }: { authorityUi: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [choosingSignOut, setChoosingSignOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { debugMode, toggleDebug } = useDebugMode();

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

  /** This app only. The authority's own session, and every other app sharing it, stays live. */
  async function signOutHere() {
    setOpen(false);
    setChoosingSignOut(false);
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.reload();
  }

  /**
   * Everywhere. A full navigation to this app's own `/auth/logout` route, which clears this app's
   * cookie server side and then redirects the browser on to the authority's own sign-out page: its
   * session cookie is `SameSite=Lax`, so only a top-level navigation carries it, never a fetch.
   */
  function signOutEverywhere() {
    setChoosingSignOut(false);
    window.location.assign('/auth/logout');
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
          className="fixed inset-x-2 top-14 z-50 w-auto overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-black/20 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-64"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${avatar}`}>
              {initials(name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{name}</p>
              <span className="mt-0.5 inline-block rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
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
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink"
              >
                <item.icon size={15} className="shrink-0 text-ink-soft" />
                <span>{item.label}</span>
              </Link>
            ))}

            <div className="mx-3 my-1 border-t border-line" />

            {/* Grouped with credentials rather than with the record screens: both answer a question about
                yourself, not about a customer. */}
            <Link
              href="/help"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink"
            >
              <LifeBuoy size={15} className="shrink-0 text-ink-soft" />
              <span>Help and roles</span>
            </Link>

            <a
              href={`${authorityUi}/profile/credentials`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink"
            >
              <KeyRound size={15} className="shrink-0 text-ink-soft" />
              <span>Your credentials</span>
            </a>

            <div className="mx-3 my-1 border-t border-line" />

            <button
              type="button"
              role="menuitem"
              onClick={toggleDebug}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-alt hover:text-ink"
            >
              <Bug size={15} className={`shrink-0 ${debugMode ? 'text-accent' : 'text-ink-soft'}`} />
              <span className="flex-1">Debug mode</span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                  debugMode ? 'border-accent/30 bg-accent/15 text-accent' : 'border-line bg-surface-alt text-ink-soft'
                }`}
              >
                {debugMode ? 'ON' : 'OFF'}
              </span>
            </button>

            <div className="mx-3 my-1 border-t border-line" />

            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); setChoosingSignOut(true); }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
            >
              <LogOut size={15} className="shrink-0 text-ink-soft" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}

      {choosingSignOut && (
        <SignOutChoiceDialog
          onHere={() => void signOutHere()}
          onEverywhere={signOutEverywhere}
          onCancel={() => setChoosingSignOut(false)}
        />
      )}
    </div>
  );
}

/**
 * One identity session behind every application here, which is what lets signing in once reach
 * every one of them. Asked rather than assumed: assuming "everywhere" signs a person out of a tab
 * they meant to leave open, assuming "just here" is the usability problem this dialog exists to
 * fix, where switching accounts silently resumed the one that was never signed out anywhere else.
 */
function SignOutChoiceDialog({ onHere, onEverywhere, onCancel }: {
  onHere: () => void;
  onEverywhere: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-sm overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Sign out</h2>
          <p className="mt-1 text-sm text-ink-soft">
            You are signed into one identity across every application here. Signing out of just this
            one leaves the others open; if you mean to switch who you are, sign out everywhere.
          </p>
        </div>
        <div className="flex flex-col gap-2 border-t border-line bg-surface-alt px-5 py-3">
          <button
            onClick={onEverywhere}
            className="flex items-center justify-center gap-2 rounded-lg bg-bank px-3 py-2 text-sm font-semibold text-bank-ink transition-colors hover:brightness-110"
          >
            <Globe2 size={14} /> Sign out everywhere
          </button>
          <button
            onClick={onHere}
            className="flex items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink transition-colors hover:bg-surface"
          >
            <Laptop size={14} /> This app only
          </button>
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-ink-soft hover:text-ink">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

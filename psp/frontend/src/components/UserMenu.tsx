'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Bug, ChevronDown, Globe2, Home, HelpCircle, KeyRound, Laptop, Layers, LogOut, UserCircle2 } from 'lucide-react';
import { ROLE_LABELS } from '../lib/constants';
import { useDebugMode } from '../lib/debugMode';
import { decodeToken } from '../lib/auth';
import { logoutSession } from '../lib/logout';

export type DecodedUser = NonNullable<ReturnType<typeof decodeToken>>;

export const ROLE_AVATAR: Record<string, { bg: string; text: string }> = {
  customer:            { bg: 'bg-blue-500',   text: 'text-white' },
  level1_analyst:      { bg: 'bg-amber-500',  text: 'text-white' },
  level2_investigator: { bg: 'bg-orange-500', text: 'text-white' },
  security_auditor:    { bg: 'bg-purple-500', text: 'text-white' },
  merchant_officer:    { bg: 'bg-teal-500',   text: 'text-white' },
  manager:             { bg: 'bg-slate-600',  text: 'text-white' },
};

export const ROLE_BADGE: Record<string, string> = {
  customer:            'bg-blue-500/15 text-blue-300 border-blue-500/30',
  level1_analyst:      'bg-amber-500/15 text-amber-300 border-amber-500/30',
  level2_investigator: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  security_auditor:    'bg-purple-500/15 text-purple-300 border-purple-500/30',
  merchant_officer:    'bg-teal-500/15 text-teal-300 border-teal-500/30',
  manager:             'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface UserMenuProps {
  user: DecodedUser;
  /** If provided, called after token is cleared (for in-page state resets).
   *  If omitted, navigates to /system after clearing the token. */
  onSignOut?: () => void;
}

export function UserMenu({ user, onSignOut }: UserMenuProps) {
  const { debugMode, toggleDebug } = useDebugMode();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [choosingSignOut, setChoosingSignOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const avatar   = ROLE_AVATAR[user.role] ?? { bg: 'bg-gray-600', text: 'text-white' };
  const badge    = ROLE_BADGE[user.role]  ?? 'bg-gray-500/15 text-gray-300 border-gray-500/30';
  const initials = getInitials(user.name);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  /**
   * This app only: the behaviour this button always had. Clears the PSP session, never touches the
   * identity authority's own session cookie, so a browser holding another app's tab (or this one,
   * signed back in) stays signed in there. Correct when the person means to leave THIS app and
   * nothing else, and wrong the moment they mean to switch who they are: the authority's session
   * outlives it, and the next sign-in anywhere resumes them without asking.
   */
  async function signOutHere() {
    setOpen(false);
    setChoosingSignOut(false);
    // Invalidate server-side (epoch bump) then clear the cookie before navigating away.
    await logoutSession();
    if (onSignOut) {
      onSignOut();
    } else {
      router.push('/system');
    }
  }

  /**
   * Everywhere: the authority's own front-channel logout, which ends the session every application
   * shares and back-channel notifies each one holding a token from it. A full navigation, not a
   * fetch, because the authority's session cookie is `SameSite=Lax` and only travels on one.
   */
  function signOutEverywhere() {
    setOpen(false);
    setChoosingSignOut(false);
    const back = new URL('/auth/logout', window.location.origin);
    back.searchParams.set('redirect', pathname || '/system');
    window.location.assign(back.toString());
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg border transition-all duration-150 ${
          open
            ? 'bg-white/10 border-white/20'
            : 'border-transparent hover:bg-white/8 hover:border-white/10'
        }`}
      >
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${avatar.bg} ${avatar.text}`}>
          {initials}
        </span>

        <span className="hidden sm:flex flex-col items-start leading-none">
          <span className="text-white text-xs font-semibold truncate max-w-32">{user.name}</span>
          <span className={`text-[10px] font-medium truncate max-w-32 ${badge.split(' ')[1]}`}>
            {ROLE_LABELS[user.role] ?? user.role}
          </span>
        </span>

        <ChevronDown
          size={13}
          className={`text-gray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          role="menu"
          className="fixed inset-x-2 top-14 w-auto sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-64 rounded-xl border border-white/10 bg-[#0d2a38] shadow-2xl shadow-black/40 overflow-hidden z-50"
        >
          <div className="px-4 py-3.5 flex items-center gap-3 border-b border-white/8">
            <span className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${avatar.bg} ${avatar.text}`}>
              {initials}
            </span>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{user.name}</p>
              <span className={`inline-block mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border ${badge}`}>
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            </div>
          </div>

          <div className="py-1.5">
            <Link
              href="/system/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/8 hover:text-white transition-colors"
            >
              <UserCircle2 size={15} className="text-gray-400 shrink-0" />
              <span>My Profile</span>
            </Link>

            <Link
              href="/system/applications"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/8 hover:text-white transition-colors"
            >
              <Layers size={15} className="text-gray-400 shrink-0" />
              <span>Applications</span>
            </Link>

            <Link
              href="/system/profile/credentials"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/8 hover:text-white transition-colors"
            >
              <KeyRound size={15} className="text-gray-400 shrink-0" />
              <span>Credentials</span>
            </Link>

            <Link
              href="/system/help"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/8 hover:text-white transition-colors"
            >
              <HelpCircle size={15} className="text-gray-400 shrink-0" />
              <span>Help &amp; Guide</span>
            </Link>

            <Link
              href="/"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/8 hover:text-white transition-colors"
            >
              <Home size={15} className="text-gray-400 shrink-0" />
              <span>PSP portal</span>
            </Link>

            <div className="my-1 mx-3 border-t border-white/8" />

            <button
              role="menuitem"
              onClick={() => { toggleDebug(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/8 hover:text-white transition-colors text-left"
            >
              <Bug size={15} className={debugMode ? 'text-[#00ED64]' : 'text-gray-400'} />
              <span className="flex-1">Debug mode</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                debugMode ? 'bg-[#00ED64]/15 text-[#00ED64] border border-[#00ED64]/30' : 'bg-white/8 text-gray-500 border border-white/10'
              }`}>
                {debugMode ? 'ON' : 'OFF'}
              </span>
            </button>

            <div className="my-1 mx-3 border-t border-white/8" />

            <button
              role="menuitem"
              onClick={() => { setOpen(false); setChoosingSignOut(true); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-red-500/10 hover:text-red-300 transition-colors text-left"
            >
              <LogOut size={15} className="text-gray-400 shrink-0" />
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
 * Signing in once and reaching every application without a second prompt is what the shared
 * identity session buys; the account of that is that the session outlives this one app's own
 * logout. Asked here rather than assumed, because assuming either answer is wrong for somebody:
 * assuming "everywhere" signs a person out of a merchant tab they meant to leave open, assuming
 * "just here" is the exact bug this dialog exists to fix, where switching accounts silently
 * resumed the one that was never signed out anywhere else.
 */
function SignOutChoiceDialog({ onHere, onEverywhere, onCancel }: {
  onHere: () => void;
  onEverywhere: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-sm overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Sign out</h2>
          <p className="mt-1 text-sm text-gray-500">
            You are signed into one identity across every application here. Signing out of just this
            one leaves the others open; if you mean to switch who you are, sign out everywhere.
          </p>
        </div>
        <div className="flex flex-col gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
          <button
            onClick={onEverywhere}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#001E2B] px-3 py-2 text-sm font-semibold text-[#00ED64] transition-colors hover:bg-[#00ED64] hover:text-[#001E2B]"
          >
            <Globe2 size={14} /> Sign out everywhere
          </button>
          <button
            onClick={onHere}
            className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
          >
            <Laptop size={14} /> This app only
          </button>
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

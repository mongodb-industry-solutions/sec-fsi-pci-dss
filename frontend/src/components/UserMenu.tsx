'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bug, ChevronDown, HelpCircle, Layers, LogOut, UserCircle2 } from 'lucide-react';
import { ROLE_LABELS } from '../lib/constants';
import { useDebugMode } from '../lib/debugMode';
import { clearToken, decodeToken } from '../lib/auth';

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
  const [open, setOpen] = useState(false);
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

  function handleSignOut() {
    setOpen(false);
    clearToken();
    if (onSignOut) {
      onSignOut();
    } else {
      router.push('/system');
    }
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
          className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-white/10 bg-[#0d2a38] shadow-2xl shadow-black/40 overflow-hidden z-50"
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
              href="/system/profile/applications"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/8 hover:text-white transition-colors"
            >
              <Layers size={15} className="text-gray-400 shrink-0" />
              <span>Authorized Apps</span>
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
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-red-500/10 hover:text-red-300 transition-colors text-left"
            >
              <LogOut size={15} className="text-gray-400 shrink-0" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

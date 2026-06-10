'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken, decodeToken, isTokenExpired } from '../../lib/auth';
import { ROLE_LABELS } from '../../lib/constants';
import { DebugModeProvider, useDebugMode } from '../../lib/debugMode';
import { DemoSidebar, MobileBottomNav } from '../../components/DemoSidebar';
import Link from 'next/link';
import { Bug, ChevronDown, LogOut, UserCircle2 } from 'lucide-react';

// ── Role avatar colors ────────────────────────────────────────────────────────

const ROLE_AVATAR: Record<string, { bg: string; text: string }> = {
  customer:            { bg: 'bg-blue-500',   text: 'text-white' },
  level1_analyst:      { bg: 'bg-amber-500',  text: 'text-white' },
  level2_investigator: { bg: 'bg-orange-500', text: 'text-white' },
  security_auditor:    { bg: 'bg-purple-500', text: 'text-white' },
  merchant_officer:    { bg: 'bg-teal-500',   text: 'text-white' },
};

const ROLE_BADGE: Record<string, string> = {
  customer:            'bg-blue-500/15 text-blue-300 border-blue-500/30',
  level1_analyst:      'bg-amber-500/15 text-amber-300 border-amber-500/30',
  level2_investigator: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  security_auditor:    'bg-purple-500/15 text-purple-300 border-purple-500/30',
  merchant_officer:    'bg-teal-500/15 text-teal-300 border-teal-500/30',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── User avatar + dropdown ────────────────────────────────────────────────────

function UserMenu({ user }: { user: NonNullable<ReturnType<typeof decodeToken>> }) {
  const { debugMode, toggleDebug } = useDebugMode();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const avatar = ROLE_AVATAR[user.role] ?? { bg: 'bg-gray-600', text: 'text-white' };
  const badge  = ROLE_BADGE[user.role]  ?? 'bg-gray-500/15 text-gray-300 border-gray-500/30';
  const initials = getInitials(user.name);

  // Close on outside click or Escape
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

  function signOut() {
    setOpen(false);
    router.push('/system');
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
        {/* Avatar */}
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${avatar.bg} ${avatar.text}`}>
          {initials}
        </span>

        {/* Name + role — hidden on xs */}
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
          {/* User identity header */}
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

          {/* Menu items */}
          <div className="py-1.5">
            {/* Profile */}
            <Link
              href="/system/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-200 hover:bg-white/8 hover:text-white transition-colors"
            >
              <UserCircle2 size={15} className="text-gray-400 shrink-0" />
              <span>My Profile</span>
            </Link>

            <div className="my-1 mx-3 border-t border-white/8" />

            {/* Debug toggle */}
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

            {/* Sign out */}
            <button
              role="menuitem"
              onClick={signOut}
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

// ── Shell ─────────────────────────────────────────────────────────────────────

const NO_SHELL_PATHS = ['/system'];

function DemoShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<ReturnType<typeof decodeToken>>(null);

  useEffect(() => {
    if (pathname === '/system') return;

    const token = getToken();
    if (!token || isTokenExpired(token)) {
      router.replace('/system');
      return;
    }

    const payload = decodeToken(token);
    setUser(payload);

    if (payload && pathname === '/system') {
      const roleRedirects: Record<string, string> = {
        customer:            '/system/payment/history',
        level1_analyst:      '/system/investigation',
        level2_investigator: '/system/investigation',
        security_auditor:    '/system/audit',
      };
      const redirect = roleRedirects[payload.role];
      if (redirect) router.replace(redirect);
    }
  }, [pathname, router]);

  if (NO_SHELL_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  const ROLE_HOME: Record<string, string> = {
    customer:            '/system/payment/history',
    level1_analyst:      '/system/investigation',
    level2_investigator: '/system/investigation',
    security_auditor:    '/system/audit',
  };
  const roleHome = (user && ROLE_HOME[user.role]) ?? '/system/payment/history';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top header — sticky */}
      <header className="sticky top-0 z-20 bg-[#001E2B] border-b border-white/8 px-3 sm:px-5 h-12 flex items-center justify-between shrink-0 gap-3">
        {/* Brand */}
        <Link
          href={roleHome}
          className="flex items-center gap-2 text-[#00ED64] font-bold text-sm whitespace-nowrap hover:text-[#00ED64]/80 transition-colors"
        >
          <span className="text-base">🏦</span>
          <span className="hidden xs:inline">Payment Gateway</span>
          <span className="xs:hidden">PG</span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {user && <UserMenu user={user} />}
        </div>
      </header>

      {/* Sidebar + content */}
      <div className="flex flex-1">
        <DemoSidebar />
        <div className="flex-1 min-w-0 pb-16 md:pb-0">
          {children}
        </div>
      </div>
      <MobileBottomNav />
    </div>
  );
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <DebugModeProvider>
      <DemoShell>{children}</DemoShell>
    </DebugModeProvider>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken, decodeToken, isTokenExpired } from '../../lib/auth';
import { ROLE_LABELS } from '../../lib/constants';
import { DebugModeProvider, useDebugMode } from '../../lib/debugMode';
import { DemoSidebar, MobileBottomNav } from '../../components/DemoSidebar';
import Link from 'next/link';
import { Bug, LogOut } from 'lucide-react';

const NO_SHELL_PATHS = ['/system'];

function DemoShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { debugMode, toggleDebug } = useDebugMode();
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
      {/* Top panel  -  sticky so it stays visible when content scrolls */}
      <header className="sticky top-0 z-20 bg-[#001E2B] text-white px-3 sm:px-4 py-3 flex justify-between items-center shrink-0 gap-2">
        <Link href={roleHome} className="font-bold text-[#00ED64] text-sm sm:text-base whitespace-nowrap hover:text-[#00ED64]/80 transition-colors">
          🏦 Payment Gateway
        </Link>
        <div className="flex items-center gap-2 sm:gap-3 text-sm min-w-0">
          {user && (
            <Link href="/system/profile" className="hidden sm:inline bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded truncate max-w-48 hover:bg-blue-500/30 transition-colors">
              {user.name} · {ROLE_LABELS[user.role] ?? user.role}
            </Link>
          )}
          {/* Compact user chip on small screens */}
          {user && (
            <Link href="/system/profile" className="sm:hidden bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded text-xs truncate max-w-24 hover:bg-blue-500/30 transition-colors">
              {user.name.split(' ')[0]}
            </Link>
          )}
          <button
            onClick={toggleDebug}
            title="Toggle debug mode"
            className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors shrink-0 ${
              debugMode
                ? 'bg-[#00ED64] text-[#001E2B] border-[#00ED64] font-semibold'
                : 'text-gray-400 border-white/20 hover:border-white/40'
            }`}
          >
            <Bug size={13} />
            <span className="hidden sm:inline">{debugMode ? 'Debug ON' : 'Debug'}</span>
          </button>
          <Link href="/system" className="inline-flex items-center gap-1 text-gray-400 hover:text-white shrink-0">
            <LogOut size={14} />
            <span className="hidden sm:inline text-sm">Sign out</span>
          </Link>
        </div>
      </header>

      {/* Sidebar + content row - document scrolls, sidebar is sticky */}
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

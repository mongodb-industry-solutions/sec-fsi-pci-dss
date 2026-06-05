'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken, decodeToken, isTokenExpired } from '../../lib/auth';
import { ROLE_LABELS } from '../../lib/constants';
import { DebugModeProvider, useDebugMode } from '../../lib/debugMode';
import { DemoSidebar } from '../../components/DemoSidebar';
import Link from 'next/link';
import { Settings, LogOut } from 'lucide-react';

const NO_SHELL_PATHS = ['/demo'];

function DemoShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { debugMode, toggleDebug } = useDebugMode();
  const [user, setUser] = useState<ReturnType<typeof decodeToken>>(null);

  useEffect(() => {
    if (pathname === '/demo') return;

    const token = getToken();
    if (!token || isTokenExpired(token)) {
      router.replace('/demo');
      return;
    }

    const payload = decodeToken(token);
    setUser(payload);

    if (payload && pathname === '/demo') {
      const roleRedirects: Record<string, string> = {
        customer:            '/demo/payment/history',
        level1_analyst:      '/demo/investigation',
        level2_investigator: '/demo/investigation',
        security_auditor:    '/demo/audit',
      };
      const redirect = roleRedirects[payload.role];
      if (redirect) router.replace(redirect);
    }
  }, [pathname, router]);

  if (NO_SHELL_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top panel  -  full width, above sidebar */}
      <header className="bg-[#001E2B] text-white px-3 sm:px-4 py-3 flex justify-between items-center z-20 shrink-0 gap-2">
        <span className="font-bold text-[#00ED64] text-sm sm:text-base whitespace-nowrap">🏦 Payment Gateway</span>
        <div className="flex items-center gap-2 sm:gap-3 text-sm min-w-0">
          {user && (
            <span className="hidden sm:inline bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded truncate max-w-48">
              {user.name} · {ROLE_LABELS[user.role] ?? user.role}
            </span>
          )}
          {/* Compact user chip on small screens */}
          {user && (
            <span className="sm:hidden bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded text-xs truncate max-w-24">
              {user.name.split(' ')[0]}
            </span>
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
            <Settings size={13} />
            <span className="hidden sm:inline">{debugMode ? 'Debug ON' : 'Debug'}</span>
          </button>
          <Link href="/demo" className="inline-flex items-center gap-1 text-gray-400 hover:text-white shrink-0">
            <LogOut size={14} />
            <span className="hidden sm:inline text-sm">Sign out</span>
          </Link>
        </div>
      </header>

      {/* Sidebar + content row */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <DemoSidebar />
        <div className="flex-1 overflow-auto min-w-0">
          {children}
        </div>
      </div>
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

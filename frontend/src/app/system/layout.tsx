'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken, decodeToken, isTokenExpired } from '../../lib/auth';
import { DebugModeProvider } from '../../lib/debugMode';
import { DemoSidebar, MobileBottomNav } from '../../components/DemoSidebar';
import { UserMenu } from '../../components/UserMenu';
import { NotificationBell } from '../../components/NotificationBell';
import Link from 'next/link';

// ── Shell ─────────────────────────────────────────────────────────────────────

const NO_SHELL_PATHS = ['/system'];

function DemoShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<ReturnType<typeof decodeToken>>(null);

  useEffect(() => {
    document.title = 'Sec4 Pay';
  }, []);

  useEffect(() => {
    if (pathname === '/system') return;

    const token = getToken();
    if (!token || isTokenExpired(token)) {
      router.replace('/system');
      return;
    }

    setUser(decodeToken(token));
  }, [pathname, router]);

  if (NO_SHELL_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  const roleHome = '/system';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top header, sticky */}
      <header className="sticky top-0 z-20 bg-[#001E2B] border-b border-white/8 px-3 sm:px-5 h-12 flex items-center justify-between shrink-0 gap-3">
        {/* Brand */}
        <Link
          href={roleHome}
          className="flex items-center gap-2 text-[#00ED64] font-bold text-sm whitespace-nowrap hover:text-[#00ED64]/80 transition-colors"
        >
          <span className="text-base"><img src="/app-icon.png" alt="Sec4 Pay Icon" className="w-9 h-9 mx-auto" /> </span>
          <span className="text-[#FFFFFF] hidden xs:inline">Sec4</span><span className="hidden xs:inline">Pay</span>
          <span className="text-[#FFFFFF] xs:hidden">Sec4</span><span className="xs:hidden">Pay</span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {user && <NotificationBell />}
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

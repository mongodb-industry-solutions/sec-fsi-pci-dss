'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken, decodeToken, isTokenExpired } from '../../lib/auth';

const ROLE_REDIRECTS: Record<string, string> = {
  customer: '/demo/payment/history',
  level1_analyst: '/demo/investigation',
  level2_investigator: '/demo/investigation',
  security_auditor: '/demo/audit',
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === '/demo') return; // login page: no auth check

    const token = getToken();
    if (!token || isTokenExpired(token)) {
      router.replace('/demo');
      return;
    }

    // Role-based redirect on first load at /demo
    const payload = decodeToken(token);
    if (payload && pathname === '/demo') {
      const redirect = ROLE_REDIRECTS[payload.role];
      if (redirect) router.replace(redirect);
    }
  }, [pathname, router]);

  return <>{children}</>;
}

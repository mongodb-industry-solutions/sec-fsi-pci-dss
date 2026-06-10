'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, decodeToken } from '../../../lib/auth';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const t = getToken() ?? '';
    const u = t ? decodeToken(t) : null;
    if (!u || u.role !== 'system_admin') {
      router.replace('/system');
    }
  }, [router]);

  return <>{children}</>;
}

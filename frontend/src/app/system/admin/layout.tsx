'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, decodeToken } from '../../../lib/auth';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    // manager owns the Integration Hub; operations_officer (v29) administers the built-in
    // card / account modules. Per-page ACL (RequirePermission) still enforces resource access.
    const ADMIN_ROLES = ['manager', 'operations_officer'];
    const t = getToken() ?? '';
    const u = t ? decodeToken(t) : null;
    if (!u || !ADMIN_ROLES.includes(u.role)) {
      router.replace('/system');
    }
  }, [router]);

  return <>{children}</>;
}

'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '../../../lib/auth';
import { useEffectivePermissions } from '../../../lib/permissions';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Data-driven admin gate (ADR-030): any role holding an admin read permission may enter the section
  // (manager, operations_officer, and read-only roles like security_auditor with modules/providers view).
  // Per-page <RequirePermission> still enforces resource-level access. Wait for permissions to load to
  // avoid a redirect flicker while can() is default-deny.
  const { can, loading } = useEffectivePermissions();
  const allowed = can('modules', 'view') || can('providers', 'view') || can('roles', 'view') || can('authDomains', 'view');

  useEffect(() => {
    if (loading) return;
    if (!getToken() || !allowed) router.replace('/system');
  }, [loading, allowed, router]);

  return <>{children}</>;
}

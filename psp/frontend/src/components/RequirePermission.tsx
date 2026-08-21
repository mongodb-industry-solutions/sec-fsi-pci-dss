'use client';
import { ReactNode } from 'react';
import { useEffectivePermissions } from '../lib/permissions';
import { AccessDenied } from './AccessDenied';

// ADR-030: gate a page/section on an ACL permission. While permissions load, renders nothing
// (avoids a flash of denied content); on deny renders <AccessDenied>; otherwise the children.
export function RequirePermission({
  resource,
  action = 'view',
  children,
}: {
  resource: string;
  action?: string;
  children: ReactNode;
}) {
  const { loading, can } = useEffectivePermissions();
  if (loading) {
    return <div className="w-full px-5 sm:px-8 lg:px-12 py-8 text-center text-sm text-gray-400">Checking access…</div>;
  }
  if (!can(resource, action)) return <AccessDenied resource={resource} action={action} />;
  return <>{children}</>;
}

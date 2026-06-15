'use client';
import { ShieldX, Lock } from 'lucide-react';
import Link from 'next/link';
import { SectionHeader } from './SectionHeader';
import { useEffectivePermissions } from '../lib/permissions';
import { RESOURCE_LABELS, ACTION_LABELS, RESOURCE_BIAN } from '../config/acl';

// ADR-030: reusable "access not authorized" screen. Renders inside the /system layout (header +
// sidebar provided by layout.tsx). The role's responsibilities are derived from the live ACL
// (GET /acl/effective); never hardcoded; so they always match the actual permission matrix.
// PCI DSS Req 7 (least privilege, default-deny is shown to the user, not silently failing).
export function AccessDenied({ resource, action = 'view' }: { resource?: string; action?: string }) {
  const { perms } = useEffectivePermissions();
  const resourceLabel = resource ? (RESOURCE_LABELS[resource] ?? resource) : 'this section';
  const actionLabel = (ACTION_LABELS[action] ?? action).toLowerCase();

  const granted = Object.entries(perms?.permissions ?? {});

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={ShieldX}
        title="Access not authorized"
        description={resource ? `Your role cannot ${actionLabel} ${resourceLabel}.` : 'You do not have permission to view this section.'}
        debugInfo={resource ? `${RESOURCE_BIAN[resource] ?? resource} · denied: ${resource}:${action} · PCI DSS Req 7 (least privilege)` : undefined}
      />

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 max-w-3xl">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
            <Lock size={18} className="text-red-600" />
          </div>
          <div className="min-w-0 text-sm text-gray-700 leading-relaxed">
            <p>
              You are signed in as <span className="font-semibold">{perms?.label ?? perms?.role ?? 'your role'}</span>
              {perms?.description ? <>; {perms.description}</> : null}
            </p>
            <p className="mt-2">
              This area is restricted under the platform&apos;s role-based access control (separation of duties).
              Your role does not include <span className="font-mono text-xs bg-gray-100 rounded px-1 py-0.5">{resource ?? 'this'}:{action}</span>,
              so access is denied by default.
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">What your role can do</p>
          {granted.length === 0 ? (
            <p className="text-sm text-gray-400">No permissions are assigned to your role.</p>
          ) : (
            <ul className="space-y-1.5">
              {granted.map(([res, actions]) => (
                <li key={res} className="text-sm text-gray-700 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{RESOURCE_LABELS[res] ?? res}</span>
                  <span className="text-gray-300">·</span>
                  {(actions as string[]).map((a) => (
                    <span key={a} className="text-[11px] px-1.5 py-0.5 rounded bg-[#00ED64]/10 text-[#007a4d] border border-[#00ED64]/30 font-medium">
                      {ACTION_LABELS[a] ?? a}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pt-1">
          <Link href="/system" className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

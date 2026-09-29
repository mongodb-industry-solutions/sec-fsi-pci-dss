'use client';
import Link from 'next/link';
import { ScrollText } from 'lucide-react';
import { useEffectivePermissions } from '../lib/permissions';

// Deep link from a business record to its audit trail. /system/audit-events reads every filter
// from the query string, so a prefiltered link is all an oversight role needs to jump from the
// record to the events that reference it (PCI DSS: the trail must be reachable).
// Rendered only for roles that hold auditEvents:view, so it never advertises a 403.

export interface AuditTrailLinkProps {
  /** Any reference the events carry: transaction id, case id, merchant id, account ref, card token. */
  reference: string;
  /** Narrows the stream to one entity kind when the reference belongs to exactly one. */
  entityType?: 'transaction' | 'fraud_case' | 'merchant' | 'customer' | 'integration';
  /** Extra query filters, e.g. { source: 'compliance' }. */
  filters?: Record<string, string>;
  label?: string;
  className?: string;
}

export function auditEventsHref(
  reference: string,
  entityType?: string,
  filters?: Record<string, string>,
): string {
  const params = new URLSearchParams({ ref: reference });
  if (entityType) params.set('entityType', entityType);
  for (const [k, v] of Object.entries(filters ?? {})) if (v) params.set(k, v);
  return `/system/audit-events?${params.toString()}`;
}

export function AuditTrailLink({
  reference,
  entityType,
  filters,
  label = 'View audit trail',
  className = '',
}: AuditTrailLinkProps) {
  const { loading, can } = useEffectivePermissions();
  if (loading || !can('auditEvents', 'view') || !reference) return null;

  return (
    <Link
      href={auditEventsHref(reference, entityType, filters)}
      title="Open the audit events filtered by this record"
      className={`inline-flex items-center gap-1.5 rounded-lg border border-[#001E2B] px-3 py-1.5 text-xs font-medium text-[#001E2B] transition-colors hover:bg-[#001E2B] hover:text-[#00ED64] ${className}`}
    >
      <ScrollText size={13} /> {label}
    </Link>
  );
}

export default AuditTrailLink;

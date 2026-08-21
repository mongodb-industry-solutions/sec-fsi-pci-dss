'use client';
// A titled card grouping record fields, with an optional group tooltip and access note.
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from '../Tooltip';

export function RecordGroup({
  icon: Icon,
  title,
  info,
  accessNote,
  badge,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  /** What this group is, in one sentence, with its BIAN origin. */
  info?: string;
  /** Why some fields here are masked or missing at the caller's access level. */
  accessNote?: string;
  /** Optional trailing chip (tier badge, status pill). */
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5">
          {Icon && <Icon size={15} />}{title}
          {info && <Tooltip text={info} />}
        </h3>
        {badge}
      </div>
      <dl className="text-sm">{children}</dl>
      {accessNote && <p className="text-xs text-gray-400 pt-2">{accessNote}</p>}
    </div>
  );
}

/** Two-column grid of groups from lg up, single column below (P8). */
export function RecordGroupGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">{children}</div>;
}

'use client';
import type { LucideIcon } from 'lucide-react';
import { ShieldCheck, Info } from 'lucide-react';
import { useDebugMode } from '../lib/debugMode';

/**
 * Consistent header for every /system section page, matching the /system/help style:
 *  - icon in a rounded box on the left
 *  - title above a description subtitle on the right
 *  - optional actions on the far right
 *  - debug-only: BIAN service domain + PCI DSS mapping shown as a separate, signposted card
 */
export function SectionHeader({ icon: Icon, title, description, info, debugInfo, actions }: {
  icon: LucideIcon;
  title: string;
  /** Short one-line subtitle. Keep it brief so icon/title/subtitle stay aligned. */
  description: string;
  /** Optional longer explanation, rendered as a separate info note below the header. */
  info?: React.ReactNode;
  debugInfo?: string;
  actions?: React.ReactNode;
}) {
  const { debugMode } = useDebugMode();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-[#001E2B] flex items-center justify-center shrink-0">
            <Icon size={20} className="text-[#00ED64]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-[#001E2B] leading-tight">{title}</h1>
            <p className="text-gray-500 text-sm mt-0.5 truncate">{description}</p>
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>

      {info && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800 leading-relaxed flex items-start gap-2">
          <Info size={15} className="text-blue-600 mt-0.5 shrink-0" />
          <div className="min-w-0">{info}</div>
        </div>
      )}

      {debugMode && debugInfo && (
        <div className="rounded-lg border border-[#001E2B]/15 bg-[#001E2B]/[0.04] px-3 py-2 flex items-start gap-2">
          <ShieldCheck size={13} className="text-[#001E2B] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-[#001E2B] uppercase tracking-wider">Security &amp; standards</p>
            <p className="text-xs font-mono text-gray-600 mt-0.5">{debugInfo}</p>
          </div>
        </div>
      )}
    </div>
  );
}

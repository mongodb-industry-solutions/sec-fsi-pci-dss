'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

// Shared tab bar for the unified per-module admin pages (config/policies + optional data plane).
// The active tab is synced to the `?tab=` query param so tabs are linkable and back/forward works.

export interface ModuleTab {
  key: string;
  label: string;
}

export function useActiveTab(tabs: ModuleTab[], fallback: string): [string, (key: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get('tab');
  const active = tabs.some((t) => t.key === requested) ? (requested as string) : fallback;
  const setActive = (key: string) => {
    const qs = new URLSearchParams(params.toString());
    qs.set('tab', key);
    router.replace(`${pathname}?${qs.toString()}`, { scroll: false });
  };
  return [active, setActive];
}

export function ModuleTabsBar({ tabs, active, onChange }: { tabs: ModuleTab[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="border-b border-gray-200 flex gap-1">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              on ? 'border-[#001E2B] text-[#001E2B]' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

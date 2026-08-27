'use client';
import { useState } from 'react';

// Rules and data on one surface, the way the provider's module pages had it.
//
// Configuring the issuer and administering the cards it issued are the same job from an operator's seat: they
// arrive here to fix something and should not have to know which of two screens holds the half they need.
// Separate pages would also make it possible to change a rule while looking at a stale card list.

export interface Tab {
  key: string;
  label: string;
  content: React.ReactNode;
}

export function ModuleTabs({ tabs, initial }: { tabs: Tab[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key);
  const current = tabs.find((tab) => tab.key === active) ?? tabs[0];

  return (
    <div className="space-y-4">
      {/* Scrolls inside its own strip on a narrow screen rather than wrapping into two rows of tabs. */}
      <div
        role="tablist"
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={tab.key === active}
            onClick={() => setActive(tab.key)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm transition ${
              tab.key === active
                ? 'border-accent font-medium text-accent'
                : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current?.content}</div>
    </div>
  );
}

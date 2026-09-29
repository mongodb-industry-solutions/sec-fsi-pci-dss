'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The help section's own tabs. Client-side only because the active one has to follow the URL, and a help
// page that does not tell you where you are is a page you leave.

const TABS = [
  { href: '/help', label: 'What this is' },
  { href: '/help/roles', label: 'Roles' },
  { href: '/help/mongodb', label: 'Why MongoDB' },
];

export function HelpNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 border-b border-line pb-2" aria-label="Help sections">
      {TABS.map((tab) => {
        // `/help` must not light up for `/help/roles`, so the root is matched exactly and the rest by prefix.
        const active = tab.href === '/help' ? pathname === '/help' : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              active ? 'bg-surface-alt font-semibold text-ink' : 'text-ink-soft hover:bg-surface-alt hover:text-ink'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

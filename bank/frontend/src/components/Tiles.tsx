import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';

// One tile shape for every navigable card, so the two sections of the home page stay visually identical and
// a third one added later cannot drift.

export interface Tile {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    // One column on a phone, two from a tablet, three on a wide desktop. `auto-rows-fr` keeps a tile with a
    // longer description the same height as its neighbours instead of ragging the row.
    <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <Link
          key={tile.href}
          href={tile.href}
          className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 transition hover:border-accent focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <tile.icon size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{tile.label}</p>
            {/* `text-pretty` avoids the one-word last line that makes a dense grid look broken. */}
            <p className="mt-0.5 text-pretty text-xs leading-relaxed text-ink-soft">{tile.description}</p>
          </div>
          <ChevronRight
            size={16}
            className="mt-0.5 shrink-0 text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-accent"
            aria-hidden
          />
        </Link>
      ))}
    </div>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{children}</h2>;
}

export function PageTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
      {/* Capped for readability: a description running the full width of a desktop is a line nobody finishes. */}
      <p className="max-w-2xl text-pretty text-sm leading-relaxed text-ink-soft">{description}</p>
    </div>
  );
}

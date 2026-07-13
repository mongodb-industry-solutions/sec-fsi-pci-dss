// Small shared presentational bits used across pages (server-safe).
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tip } from './Tooltip';

/** Inline "?" info affordance with an accessible tooltip. */
export function InfoHint({ label }: { label: ReactNode }) {
  return (
    <Tip label={label}>
      <button type="button" aria-label="More info" className="text-muted/70 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full">
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tip>
  );
}

type Tone = 'ok' | 'warn' | 'err' | 'neutral' | 'accent';
const TONES: Record<Tone, string> = {
  // Light green bg (light mode) → near-black text for contrast; dark mode bg is dark green,
  // so the green text is kept there (readable on dark). `dark:` follows prefers-color-scheme.
  ok: 'text-leaf-ink bg-[var(--ok-bg)] dark:text-[var(--ok)]',
  warn: 'text-[var(--warn)] bg-[var(--warn-bg)]',
  err: 'text-[var(--err)] bg-[var(--err-bg)]',
  neutral: 'text-muted bg-surface-alt',
  // Fixed brand colors (not theme-flipped): dark ink text on the bright leaf green reads
  // clearly in BOTH light and dark themes. The previous leaf-on-leaf tint was low-contrast
  // (especially in dark mode).
  accent: 'text-leaf-ink bg-leaf ring-1 ring-leaf-deep/20',
};

/** Status/label chip. */
export function Chip({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Skeleton loading grid used by route-level loading.tsx files. */
export function SkeletonList({ rows = 4, title = 'Loading' }: { rows?: number; title?: string }) {
  return (
    <div aria-busy="true" aria-label={`${title}…`}>
      <div className="skeleton mb-6 h-8 w-52" />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="card space-y-3 p-5">
            <div className="skeleton h-9 w-9 rounded-xl" />
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-3 w-1/2" />
            <div className="skeleton h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Consistent empty / info state with an icon and one-line guidance. */
export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
      <div className="text-muted" aria-hidden>{icon}</div>
      <p className="mt-3 font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-muted">{hint}</p>}
    </div>
  );
}

'use client';
import { useId } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

// The parts every administration list needs, in one place: a filter bar, a status summary, a page control.
//
// Extracted rather than written twice because the cards list and the accounts list differ only in their
// columns and their filters. Two copies would drift, and the one that drifts is always the one nobody is
// looking at.

export interface FilterSpec {
  key: string;
  label: string;
  // A select when options are given, a text input otherwise.
  options?: string[];
  placeholder?: string;
}

export function FilterBar({
  filters, values, onChange, onSearch, searchValue, searchHint, total,
}: {
  filters: FilterSpec[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSearch: (value: string) => void;
  searchValue: string;
  searchHint: string;
  total: number;
}) {
  const searchId = useId();
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3 sm:p-4">
      {/* The search is full width on a phone and shares the row from `sm`: a filter bar that wraps into six
          rows on a narrow screen pushes the results off the fold entirely. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor={searchId} className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-soft">
            Search
          </label>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden />
            <input
              id={searchId}
              value={searchValue}
              onChange={(event) => onSearch(event.target.value)}
              placeholder={searchHint}
              className="w-full rounded-lg border border-line bg-canvas py-2 pl-9 pr-3 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
          {filters.map((filter) => (
            <div key={filter.key} className="min-w-0">
              <label className="mb-1 block truncate text-[11px] font-medium uppercase tracking-wide text-ink-soft">
                {filter.label}
              </label>
              {filter.options ? (
                <select
                  value={values[filter.key] ?? ''}
                  onChange={(event) => onChange(filter.key, event.target.value)}
                  className="w-full rounded-lg border border-line bg-canvas px-2 py-2 text-sm outline-none focus:border-accent sm:w-auto"
                >
                  <option value="">Any</option>
                  {filter.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : (
                <input
                  value={values[filter.key] ?? ''}
                  onChange={(event) => onChange(filter.key, event.target.value)}
                  placeholder={filter.placeholder}
                  className="w-full rounded-lg border border-line bg-canvas px-2 py-2 text-sm outline-none focus:border-accent sm:w-28"
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-ink-soft">
        {total} {total === 1 ? 'record' : 'records'} match.
      </p>
    </div>
  );
}

export function StatusSummary({ counts, active, onPick }: {
  counts: Record<string, number>;
  active: string;
  onPick: (status: string) => void;
}) {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  return (
    // Scrolls sideways INSIDE its own strip on a narrow screen, which is what keeps the page from doing it.
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {entries.map(([status, count]) => (
        <button
          key={status}
          type="button"
          onClick={() => onPick(active === status ? '' : status)}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
            active === status
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-line bg-surface text-ink-soft hover:border-accent'
          }`}
        >
          {status} <span className="font-semibold">{count}</span>
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, limit, total, onPage }: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-xs disabled:opacity-40"
      >
        <ChevronLeft size={14} aria-hidden /> Previous
      </button>
      <span className="text-xs text-ink-soft">Page {page} of {pages}</span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= pages}
        className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-xs disabled:opacity-40"
      >
        Next <ChevronRight size={14} aria-hidden />
      </button>
    </div>
  );
}

const TONE: Record<string, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  issued: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  pending_approval: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  suspended: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  blocked: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  revoked: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  closed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[status] ?? 'border-line bg-surface-alt text-ink-soft'}`}>
      {status}
    </span>
  );
}

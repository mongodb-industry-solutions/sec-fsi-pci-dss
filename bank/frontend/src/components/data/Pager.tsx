'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

// The ONE page control on this app. Cards, accounts, holders, consents, deliveries and the audit trail all
// use this and nothing else, so paging behaves identically everywhere and the page-size options exist in a
// single place rather than as a number typed into six screens.
//
// The options stop at 150 because the bank's own API refuses more, and the default is 10 because an operator
// scanning a list reads the first rows and pages rather than scrolling a hundred.

export const PAGE_SIZES = [10, 25, 50, 100, 150];
export const DEFAULT_PAGE_SIZE = 10;

export function Pager({
  page, limit, total, noun, onPage, onLimit,
}: {
  page: number;
  limit: number;
  total: number;
  noun: string;
  onPage: (page: number) => void;
  onLimit: (limit: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const [jump, setJump] = useState('');

  function commitJump() {
    const wanted = Number.parseInt(jump, 10);
    if (wanted >= 1 && wanted <= pages) onPage(wanted);
    setJump('');
  }

  // The window of numbered pages, so 40 pages do not render 40 buttons.
  function windowed(): (number | 'gap')[] {
    if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
    const list: (number | 'gap')[] = [1];
    const left = Math.max(2, page - 1);
    const right = Math.min(pages - 1, page + 1);
    if (left > 2) list.push('gap');
    for (let index = left; index <= right; index += 1) list.push(index);
    if (right < pages - 1) list.push('gap');
    list.push(pages);
    return list;
  }

  return (
    // Stacks on a phone and sits on one line from `md`. The count comes last on a narrow screen, because the
    // control an operator reaches for is the one that should be nearest the list.
    <div className="flex flex-col gap-3 py-1 md:flex-row md:items-center md:justify-between">
      <p className="order-last text-xs text-ink-soft md:order-first">
        {total === 0 ? `No ${noun}` : (
          <>
            <span className="font-semibold text-ink">{from}</span>
            <span className="mx-1">to</span>
            <span className="font-semibold text-ink">{to}</span>
            <span className="mx-1.5 text-line">|</span>
            <span className="font-semibold text-ink">{total}</span>
            <span className="ml-1">{noun}</span>
          </>
        )}
      </p>

      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-0.5 overflow-x-auto">
          <PagerButton label="First page" onClick={() => onPage(1)} disabled={page <= 1}>
            <ChevronsLeft size={14} aria-hidden />
          </PagerButton>
          <PagerButton label="Previous page" onClick={() => onPage(page - 1)} disabled={page <= 1}>
            <ChevronLeft size={14} aria-hidden />
          </PagerButton>

          <span className="mx-1 flex items-center gap-0.5">
            {windowed().map((entry, index) => (entry === 'gap' ? (
              <span key={`gap-${index}`} className="flex h-9 w-6 items-center justify-center text-ink-soft">···</span>
            ) : (
              <button
                key={entry}
                type="button"
                onClick={() => onPage(entry)}
                aria-current={entry === page ? 'page' : undefined}
                className={`h-9 min-w-9 rounded-lg px-2 text-sm transition ${
                  entry === page
                    ? 'bg-accent/15 font-semibold text-accent'
                    : 'text-ink-soft hover:bg-surface-alt hover:text-ink'
                }`}
              >
                {entry}
              </button>
            )))}
          </span>

          <PagerButton label="Next page" onClick={() => onPage(page + 1)} disabled={page >= pages}>
            <ChevronRight size={14} aria-hidden />
          </PagerButton>
          <PagerButton label="Last page" onClick={() => onPage(pages)} disabled={page >= pages}>
            <ChevronsRight size={14} aria-hidden />
          </PagerButton>

          {/* Jumping straight to a page matters once a list runs past a handful of them. */}
          <span className="ml-2 hidden items-center gap-1.5 border-l border-line pl-3 sm:flex">
            <span className="text-xs text-ink-soft">Go to</span>
            <input
              type="number"
              min={1}
              max={pages}
              value={jump}
              onChange={(event) => setJump(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') commitJump(); }}
              onBlur={commitJump}
              placeholder={String(page)}
              aria-label="Go to page"
              className="h-9 w-14 rounded-lg border border-line bg-canvas text-center text-xs outline-none focus:border-accent"
            />
          </span>
        </nav>
      )}

      <label className="flex shrink-0 items-center gap-2 text-xs text-ink-soft">
        <span className="hidden sm:inline">Per page</span>
        <select
          value={limit}
          onChange={(event) => onLimit(Number(event.target.value))}
          aria-label="Records per page"
          className="h-9 rounded-lg border border-line bg-canvas px-2 text-xs outline-none focus:border-accent"
        >
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
    </div>
  );
}

function PagerButton({
  label, onClick, disabled, children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      // 36px square: a touch target a thumb can actually hit, which a 24px chevron is not.
      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-alt hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

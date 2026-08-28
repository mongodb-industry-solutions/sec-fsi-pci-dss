'use client';
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronDown, ChevronRight, Download, Loader2, RotateCw, Search, SlidersHorizontal, X,
} from 'lucide-react';
import { admin, AdminError, type PagedResult } from '../../lib/adminClient';
import { buildExtract, downloadJsonFile } from '../../lib/downloadJson';
import { JsonView } from '../JsonView';
import { BankError, Empty } from '../States';
import { DEFAULT_PAGE_SIZE, Pager } from './Pager';
import { DateRangeFilter } from './DateRangeFilter';

// EVERY list in this app, from one component.
//
// The cards, the accounts, the holders, the consents, the notification deliveries and the audit trail are the
// same screen with different columns: search, filter, page, export. Written six times, they drift, and the one
// that drifts is always the one nobody is looking at. One of them had already grown a page control the others
// did not have.
//
// Three properties come from being one component:
//
//  - The QUERY LIVES IN THE URL. A filtered list is a link an operator can send to a colleague or return to
//    from a browser's back button, rather than something that has to be reproduced by hand.
//  - EXPORT is available wherever a list is, because it is here rather than bolted onto one screen. It walks
//    the pages behind the current filters and says in the file what it took and whether it was complete.
//  - AN EMPTY RESULT AND A FAILED CALL LOOK DIFFERENT. That distinction is the whole reason this app has a
//    shared error state, and putting the fetch here is what stops a screen forgetting it.

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  /** Dropped from the table below `lg`, still shown on the card layout. The narrow screen keeps the essentials. */
  secondary?: boolean;
  align?: 'right';
}

export interface FilterSpec {
  key: string;
  label: string;
  /** A select when options are given, a text input otherwise. */
  options?: { value: string; label: string }[];
  placeholder?: string;
  /**
   * Renders a date-and-time range control instead of a plain input, writing to TWO query keys.
   *
   * A window is one question ("when?") answered by two bounds, so it is one control rather than two fields an
   * operator has to keep consistent. `key` stays the identity of the filter for the URL and the bar.
   */
  dateRange?: { fromKey: string; toKey: string };
}

export interface DataListProps<T> {
  /** The bank's resource path, e.g. `cards` or `tpp/deliveries`. */
  resource: string;
  noun: string;
  searchHint: string;
  /** `auto` derives the columns from the records, for a resource whose shape is the bank's to change. */
  columns: Column<T>[] | 'auto';
  filters?: FilterSpec[];
  /** Filters fixed by the page rather than chosen by the operator, e.g. the account a card list belongs to. */
  fixed?: Record<string, string>;
  rowHref?: (row: T) => string;
  rowKey?: (row: T) => string;
  /** Status chips above the list, from the counts the bank returns with the page. */
  statusFilterKey?: string;
  /** Shown when the result is empty, so each list explains its own emptiness. */
  emptyMessage?: string;
  /** Expandable per-row detail. `auto` renders the record as a JSON tree, which is what a log row needs. */
  expand?: 'auto' | ((row: T) => React.ReactNode);
  toolbar?: React.ReactNode;
  /** Bumped by a caller to force a refetch after it changed something. */
  refreshToken?: number;
}

type Row = Record<string, unknown>;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function humanise(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

export function DataList<T extends Row>({
  resource, noun, searchHint, columns, filters = [], fixed, rowHref, rowKey,
  statusFilterKey, emptyMessage, expand, toolbar, refreshToken,
}: DataListProps<T>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchId = useId();

  // The URL is the state. Read from it on every render rather than mirrored into local state, so the back
  // button and a pasted link behave the same as clicking.
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const limit = Number(searchParams.get('limit') ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE;
  const query = searchParams.get('q') ?? '';
  const filterValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const filter of filters) {
      if (filter.dateRange) {
        // A range owns two keys and not its own, so reading `filter.key` here would send an empty parameter
        // the bank does not know.
        values[filter.dateRange.fromKey] = searchParams.get(filter.dateRange.fromKey) ?? '';
        values[filter.dateRange.toKey] = searchParams.get(filter.dateRange.toKey) ?? '';
      } else {
        values[filter.key] = searchParams.get(filter.key) ?? '';
      }
    }
    return values;
  }, [filters, searchParams]);

  const [result, setResult] = useState<PagedResult<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The search box is local while it is being typed, and pushed to the URL after a pause: a URL write per
  // keystroke would put a history entry behind every letter.
  const [draftQuery, setDraftQuery] = useState(query);
  const draftRef = useRef(query);

  useEffect(() => {
    // A change arriving from outside (the back button, a cleared filter) has to reach the box.
    if (query !== draftRef.current) {
      draftRef.current = query;
      setDraftQuery(query);
    }
  }, [query]);

  const writeParams = useCallback((changes: Record<string, string | number | undefined>) => {
    // Built from the LIVE address, not from the render's snapshot of it.
    //
    // `useSearchParams` gives the query as of the last render, and `router.replace` updates the address before
    // the next one arrives. Two changes in quick succession therefore both read the same stale snapshot, and the
    // second silently discards the first: clearing a date window right after setting it reinstated the dates,
    // because "clear" was computed against a query that did not have them yet.
    const current = typeof window === 'undefined' ? searchParams.toString() : window.location.search;
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    // Any change other than the page itself returns to the first page. Staying on page 7 of a new filter is
    // how a list appears empty when it is not.
    if (!('page' in changes)) next.delete('page');
    router.replace(next.size ? `?${next}` : '?', { scroll: false });
  }, [router, searchParams]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (draftQuery !== query) {
        draftRef.current = draftQuery;
        writeParams({ q: draftQuery });
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [draftQuery, query, writeParams]);

  // `fixed` is applied LAST, so a filter the page has pinned cannot be undone by the URL.
  //
  // The order used to be the other way round, and it silently broke the whole point of a pinned filter. Every
  // key a screen declares as a filter is read from the URL as `''` when absent, so `{...fixed, ...filterValues}`
  // wrote an empty string over `fixed.holder`, the empty value was then dropped from the query string, and the
  // owner's page asked for EVERY account and EVERY card at the bank. It looked like a working screen showing
  // the wrong records, which is the worst kind of wrong on a page about one party.
  //
  // Keyed by VALUE, not by object identity. Callers pass this as an object literal (`fixed={{ holder }}`), so a
  // new object arrives on every render; depending on its identity made `activeQuery` new every render, which
  // made the fetch effect fire every render, which set state and rendered again. A pinned list would have sat
  // there re-reading the bank forever.
  const fixedKey = JSON.stringify(fixed ?? {});
  const activeQuery = useMemo(() => ({
    ...filterValues, q: query, page, limit, ...fixed,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [fixedKey, filterValues, query, page, limit]);

  // A filter the page has pinned is not offered as a control. Leaving it in the bar would show an empty
  // "Holder reference" box on a page that is already scoped to one holder, which invites an operator to type
  // into it and wonder why nothing changes.
  const openFilters = useMemo(
    () => filters.filter((filter) => !(fixed && filter.key in fixed)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters, fixedKey],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    admin.list<T>(resource, activeQuery)
      .then((payload) => {
        if (!live) return;
        setResult(payload);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        // The bank's own sentence, kept: "unreachable" and "refused" send whoever is debugging to different
        // places, and a generic failure hides which one it was.
        setError(cause instanceof AdminError ? cause.message : String(cause));
        setResult(null);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [resource, activeQuery, refreshToken]);

  const rows = result?.results ?? [];
  const resolvedColumns: Column<T>[] = useMemo(() => {
    if (columns !== 'auto') return columns;
    // A resource whose shape belongs to the bank gets its columns from the records. A fixed list would need
    // editing every time the bank adds a field, and would hide the new one until someone did.
    const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
      .filter((key) => key !== '_id')
      .slice(0, 8);
    return keys.map((key, index) => ({ key, label: humanise(key), secondary: index >= 4 }));
  }, [columns, rows]);

  const keyOf = useCallback((row: T, index: number) => (
    rowKey ? rowKey(row) : cellText(row.id ?? row._id ?? index)
  ), [rowKey]);

  // The export walks the pages behind the CURRENT filters, so what lands in the file is what the operator is
  // looking at rather than the whole estate. Capped, and the cap is declared in the file: a truncated extract
  // read later as complete is worse than one that says it was cut.
  const exportJson = useCallback(async () => {
    setExporting(true);
    try {
      const PER_PAGE = 150;
      const CAP = 3000;
      const collected: T[] = [];
      let total = 0;
      for (let cursor = 1; ; cursor += 1) {
        const payload = await admin.list<T>(resource, { ...activeQuery, page: cursor, limit: PER_PAGE });
        total = payload.total;
        collected.push(...payload.results);
        if (collected.length >= payload.total || payload.results.length < PER_PAGE || collected.length >= CAP) break;
      }
      const filtersApplied = { ...fixed, ...filterValues, q: query };
      downloadJsonFile(resource.replace(/\//g, '-'), buildExtract(resource, filtersApplied, collected, total));
    } catch (cause) {
      setError(cause instanceof AdminError ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  }, [resource, activeQuery, fixed, filterValues, query]);

  const statusCounts = result?.byStatus ?? {};
  const activeStatus = statusFilterKey ? filterValues[statusFilterKey] ?? '' : '';
  // Counts only what the OPERATOR applied. A pinned filter is the page's, not theirs, so counting it would
  // show "Filters 1" on a screen where the bar is empty.
  const appliedCount = openFilters.filter((filter) => (filter.dateRange
    ? filterValues[filter.dateRange.fromKey] || filterValues[filter.dateRange.toKey]
    : filterValues[filter.key])).length;

  return (
    <div className="space-y-4">
      {/* ── The bar: search, filters, actions ─────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-xl border border-line bg-surface p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <label htmlFor={searchId} className="sr-only">Search {noun}</label>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden />
            <input
              id={searchId}
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              placeholder={searchHint}
              className="h-11 w-full rounded-lg border border-line bg-canvas pl-9 pr-9 text-sm outline-none focus:border-accent"
            />
            {draftQuery && (
              <button
                type="button"
                onClick={() => setDraftQuery('')}
                aria-label="Clear the search"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-soft hover:bg-surface-alt hover:text-ink"
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {openFilters.length > 0 && (
              <button
                type="button"
                onClick={() => setFiltersOpen((open) => !open)}
                aria-expanded={filtersOpen}
                className={`inline-flex h-11 items-center gap-2 rounded-lg border px-3 text-sm transition ${
                  appliedCount > 0 ? 'border-accent text-accent' : 'border-line text-ink-soft hover:border-accent'
                } sm:h-9`}
              >
                <SlidersHorizontal size={14} aria-hidden />
                <span>Filters</span>
                {appliedCount > 0 && (
                  <span className="rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold text-accent">{appliedCount}</span>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={exportJson}
              disabled={exporting || rows.length === 0}
              title="Download the records matching the current filters as JSON"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink-soft transition hover:border-accent hover:text-ink disabled:opacity-40 sm:h-9"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Download size={14} aria-hidden />}
              <span className="hidden sm:inline">{exporting ? 'Preparing' : 'Export'}</span>
            </button>
            <button
              type="button"
              onClick={() => writeParams({ page })}
              title="Read the list again"
              aria-label="Refresh"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line text-ink-soft transition hover:border-accent hover:text-ink sm:h-9 sm:w-9"
            >
              <RotateCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden />
            </button>
            {toolbar}
          </div>
        </div>

        {/* The filter row is collapsed by default on every size: six controls above a list push the results
            off the fold, and most visits do not filter at all. */}
        {filtersOpen && openFilters.length > 0 && (
          <div className="grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
            {openFilters.map((filter) => (filter.dateRange ? (
              <DateRangeFilter
                key={filter.key}
                label={filter.label}
                value={{
                  from: filterValues[filter.dateRange.fromKey] ?? '',
                  to: filterValues[filter.dateRange.toKey] ?? '',
                }}
                onChange={(next) => writeParams({
                  [filter.dateRange!.fromKey]: next.from,
                  [filter.dateRange!.toKey]: next.to,
                })}
              />
            ) : (
              <div key={filter.key} className="min-w-0">
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-soft">
                  {filter.label}
                </label>
                {filter.options ? (
                  <select
                    value={filterValues[filter.key] ?? ''}
                    onChange={(event) => writeParams({ [filter.key]: event.target.value })}
                    className="h-10 w-full rounded-lg border border-line bg-canvas px-2 text-sm outline-none focus:border-accent"
                  >
                    <option value="">Any</option>
                    {filter.options.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={filterValues[filter.key] ?? ''}
                    onChange={(event) => writeParams({ [filter.key]: event.target.value })}
                    placeholder={filter.placeholder}
                    className="h-10 w-full rounded-lg border border-line bg-canvas px-2 text-sm outline-none focus:border-accent"
                  />
                )}
              </div>
            )))}
            {appliedCount > 0 && (
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => writeParams(Object.fromEntries(openFilters.flatMap((f) => (f.dateRange
                    ? [[f.dateRange.fromKey, ''], [f.dateRange.toKey, '']]
                    : [[f.key, '']]))))}
                  className="text-xs text-accent hover:underline"
                >
                  Clear every filter
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Status chips, which are a filter an operator reads as a summary ───────────────────── */}
      {statusFilterKey && Object.keys(statusCounts).length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {Object.entries(statusCounts).sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => (
            <button
              key={status}
              type="button"
              onClick={() => writeParams({ [statusFilterKey]: activeStatus === status ? '' : status })}
              aria-pressed={activeStatus === status}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
                activeStatus === status
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-surface text-ink-soft hover:border-accent'
              }`}
            >
              {humanise(status)} <span className="font-semibold">{count}</span>
            </button>
          ))}
        </div>
      )}

      {error && <BankError message={error} />}

      {!error && rows.length === 0 && !loading && (
        <Empty>{emptyMessage ?? `This bank holds no ${noun} matching that.`}</Empty>
      )}

      {rows.length > 0 && (
        <>
          {/* Below `md`: one card per record. A table of eight columns at 380px is either an unreadable
              squeeze or a sideways scroll that hides the columns that matter. */}
          <ul className={`space-y-3 md:hidden ${loading ? 'opacity-60' : ''}`}>
            {rows.map((row, index) => {
              const key = keyOf(row, index);
              const href = rowHref?.(row);
              return (
                <li key={key} className="rounded-xl border border-line bg-surface p-4">
                  <dl className="space-y-2">
                    {resolvedColumns.map((column) => (
                      <div key={column.key} className="grid grid-cols-[minmax(0,8rem)_1fr] gap-2">
                        <dt className="truncate text-[11px] uppercase tracking-wide text-ink-soft">{column.label}</dt>
                        <dd className="min-w-0 break-words text-xs">
                          {column.render ? column.render(row) : cellText(row[column.key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
                    {href && (
                      <Link href={href} className="text-xs font-medium text-accent hover:underline">Open</Link>
                    )}
                    {expand && (
                      <button
                        type="button"
                        onClick={() => setOpenRow(openRow === key ? null : key)}
                        className="text-xs text-ink-soft hover:text-ink"
                      >
                        {openRow === key ? 'Hide the record' : 'Show the record'}
                      </button>
                    )}
                  </div>
                  {expand && openRow === key && (
                    <div className="mt-3">
                      {expand === 'auto' ? <JsonView data={row} title={noun} collapsed={1} /> : expand(row)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* From `md`: the table, scrolling inside its own container so the PAGE never scrolls sideways. */}
          <div className={`hidden overflow-x-auto rounded-xl border border-line bg-surface md:block ${loading ? 'opacity-60' : ''}`}>
            <table className="min-w-full text-xs">
              <thead className="bg-surface-alt">
                <tr>
                  {expand && <th scope="col" className="w-8" />}
                  {resolvedColumns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={`whitespace-nowrap px-3 py-2.5 text-left font-semibold text-ink-soft ${
                        column.secondary ? 'hidden lg:table-cell' : ''
                      } ${column.align === 'right' ? 'text-right' : ''}`}
                    >
                      {column.label}
                    </th>
                  ))}
                  {rowHref && <th scope="col" className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const key = keyOf(row, index);
                  const href = rowHref?.(row);
                  return (
                    // The key belongs on the fragment: a row and its expanded detail are two siblings of one
                    // record, and keying the inner rows instead makes React re-create them on every toggle.
                    <Fragment key={key}>
                      <tr className="border-t border-line align-top hover:bg-surface-alt/60">
                        {expand && (
                          <td className="px-1 py-2">
                            <button
                              type="button"
                              onClick={() => setOpenRow(openRow === key ? null : key)}
                              aria-expanded={openRow === key}
                              aria-label={openRow === key ? 'Hide the record' : 'Show the record'}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-surface-alt hover:text-ink"
                            >
                              {openRow === key ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                            </button>
                          </td>
                        )}
                        {resolvedColumns.map((column) => (
                          <td
                            key={column.key}
                            className={`max-w-[18rem] px-3 py-2.5 ${column.secondary ? 'hidden lg:table-cell' : ''} ${
                              column.align === 'right' ? 'text-right' : ''
                            }`}
                            title={column.render ? undefined : cellText(row[column.key])}
                          >
                            <span className="block truncate">
                              {column.render ? column.render(row) : cellText(row[column.key])}
                            </span>
                          </td>
                        ))}
                        {rowHref && (
                          <td className="px-2 py-2.5 text-right">
                            {href && (
                              <Link
                                href={href}
                                aria-label={`Open ${key}`}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft hover:bg-surface-alt hover:text-accent"
                              >
                                <ChevronRight size={14} aria-hidden />
                              </Link>
                            )}
                          </td>
                        )}
                      </tr>
                      {expand && openRow === key && (
                        <tr className="border-t border-line bg-surface-alt/40">
                          <td colSpan={resolvedColumns.length + (rowHref ? 2 : 1)} className="px-3 py-3">
                            {expand === 'auto' ? <JsonView data={row} title={noun} collapsed={1} /> : expand(row)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pager
            page={result?.page ?? page}
            limit={result?.limit ?? limit}
            total={result?.total ?? 0}
            noun={noun}
            onPage={(next) => writeParams({ page: next })}
            onLimit={(next) => writeParams({ limit: next })}
          />
        </>
      )}
    </div>
  );
}

'use client';
import { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { admin } from '../../lib/adminClient';

// Choosing a record that already exists: the owner of a new account, the account a new card draws on.
//
// A plain text box for the reference would be simpler and would also be the thing that lets an operator paste a
// reference the bank has never seen and learn about it from a 404. The list is loaded from the bank, so what can
// be picked is what exists.
//
// It is a select rather than a type-ahead over names on purpose. Holder names are encrypted with no query index,
// so the bank cannot search them: an autocomplete over names would be a box that silently matched nothing. What
// it offers instead is the masked name against its reference, which is what identifies the record here anyway.

export function ReferencePicker<T extends Record<string, unknown>>({
  label, hint, resource, value, onChange, optionLabel, optionValue, query, required,
}: {
  label: string;
  hint?: string;
  resource: string;
  value: string;
  onChange: (value: string) => void;
  optionLabel: (row: T) => string;
  optionValue: (row: T) => string;
  /** Narrows what may be picked, e.g. only the accounts belonging to one holder. */
  query?: Record<string, string | undefined>;
  required?: boolean;
}) {
  const id = useId();
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The full ceiling in one call: this is a picker, and a paged one would hide the record being looked for
  // behind a control the operator cannot see.
  const key = JSON.stringify(query ?? {});
  useEffect(() => {
    let live = true;
    setRows(null);
    admin.list<T>(resource, { ...(query ?? {}), limit: 150 })
      .then((payload) => { if (live) { setRows(payload.results); setError(null); } })
      .catch((cause: unknown) => {
        if (live) { setError(cause instanceof Error ? cause.message : String(cause)); setRows([]); }
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, key]);

  return (
    <div className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-center sm:gap-4">
      <label htmlFor={id} className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="mt-0.5 block text-pretty text-[11px] leading-relaxed text-ink-soft">{hint}</span>}
      </label>
      <div className="space-y-1">
        <div className="relative">
          <select
            id={id}
            value={value}
            required={required}
            disabled={rows === null}
            onChange={(event) => onChange(event.target.value)}
            className="h-11 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none transition focus:border-accent disabled:opacity-60 sm:h-10"
          >
            <option value="">{rows === null ? 'Reading the list…' : 'Not chosen'}</option>
            {(rows ?? []).map((row) => (
              <option key={optionValue(row)} value={optionValue(row)}>{optionLabel(row)}</option>
            ))}
          </select>
          {rows === null && (
            <Loader2 size={14} className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 animate-spin text-ink-soft" aria-hidden />
          )}
        </div>
        {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}
        {rows?.length === 0 && !error && (
          <p className="text-[11px] text-ink-soft">This bank holds no records to choose from here yet.</p>
        )}
      </div>
    </div>
  );
}

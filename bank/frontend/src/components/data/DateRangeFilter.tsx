'use client';
import { useEffect, useId, useState } from 'react';
import { CalendarDays } from 'lucide-react';

// Choosing WHEN, without typing a date.
//
// This replaced two text boxes labelled "From" and "To" whose placeholders were example dates. That asked an
// operator to know the format, offered no calendar, and made the commonest question of all ("what happened
// today?") a two-field exercise in remembering today's date. It also silently accepted `2026-8-1`, which
// matches nothing.
//
// So: presets for the questions actually asked, ONE date for a single day, and two date-and-time fields only
// when a genuine window is wanted. A single day is its own mode rather than a range with both ends equal,
// because that is how it is thought about and because filling one field beats filling two identically.
//
// The end of a plain day is inclusive: the bank extends a date-only bound to the last millisecond of that day,
// so "today" means all of today rather than everything up to midnight this morning.

export interface DateRangeValue {
  from: string;
  to: string;
}

type Mode = 'any' | 'today' | 'yesterday' | 'last7' | 'last30' | 'day' | 'between';

/**
 * A calendar date as `YYYY-MM-DD`, taken from the local clock.
 *
 * Worth being precise about what a bare date then MEANS: the bank compares it against timestamps stored in
 * UTC, so `2026-08-27` selects the UTC day of that name. For an operator in another zone the edges are
 * offset by their difference from UTC. Kept anyway, because a date reads well in a shareable URL and the
 * "between two moments" mode sends absolute instants for anyone who needs the boundary exact.
 */
function localDay(offsetDays = 0): string {
  const when = new Date();
  when.setDate(when.getDate() + offsetDays);
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${when.getFullYear()}-${month}-${day}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Which mode a pair of values represents, used to OPEN the control showing what is already applied.
 *
 * Only for the initial reading. The chosen mode is then held as state, because a value cannot always identify
 * it: "a single day" seeded with today is the same pair of bounds as the "Today" preset, so deriving the mode
 * on every render snapped the choice back to Today and the date field never appeared.
 */
function modeOf({ from, to }: DateRangeValue): Mode {
  if (!from && !to) return 'any';
  if (from && from === to && DATE_ONLY.test(from)) {
    if (from === localDay()) return 'today';
    if (from === localDay(-1)) return 'yesterday';
    return 'day';
  }
  if (DATE_ONLY.test(from) && to === localDay()) {
    if (from === localDay(-6)) return 'last7';
    if (from === localDay(-29)) return 'last30';
  }
  return 'between';
}

const PRESETS: { value: Mode; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'day', label: 'A single day' },
  { value: 'between', label: 'Between two moments' },
];

/** A local `datetime-local` value as an absolute instant, which is what the bank compares against. */
function toInstant(local: string): string {
  if (!local) return '';
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/** An absolute instant back into the `datetime-local` shape, so reopening the control shows what is applied. */
function toLocalInput(instant: string): string {
  if (!instant) return '';
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
    + `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function DateRangeFilter({
  label, value, onChange,
}: {
  label: string;
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
}) {
  const id = useId();
  // Initialised from what is applied, then owned by the operator's choice.
  const [mode, setMode] = useState<Mode>(() => modeOf(value));

  // A window cleared from outside (the "clear every filter" action, the back button) has to reset the control
  // too, or it would keep offering date fields for a filter that is no longer applied.
  useEffect(() => {
    if (!value.from && !value.to) setMode('any');
  }, [value.from, value.to]);

  function pick(next: Mode) {
    setMode(next);
    switch (next) {
      case 'any': return onChange({ from: '', to: '' });
      // Both ends the same day. The bank makes the end inclusive, so this is the whole day.
      case 'today': return onChange({ from: localDay(), to: localDay() });
      case 'yesterday': return onChange({ from: localDay(-1), to: localDay(-1) });
      case 'last7': return onChange({ from: localDay(-6), to: localDay() });
      case 'last30': return onChange({ from: localDay(-29), to: localDay() });
      // Seeded with today so the calendar opens somewhere useful rather than empty.
      case 'day': return onChange({ from: localDay(), to: localDay() });
      case 'between': return onChange({ from: toInstant(`${localDay()}T00:00`), to: toInstant(`${localDay()}T23:59`) });
      default: return undefined;
    }
  }

  return (
    <div className="min-w-0 space-y-2 sm:col-span-2">
      <label htmlFor={id} className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-soft">
        <CalendarDays size={12} aria-hidden /> {label}
      </label>

      <select
        id={id}
        value={mode}
        onChange={(event) => pick(event.target.value as Mode)}
        className="h-10 w-full rounded-lg border border-line bg-canvas px-2 text-sm outline-none focus:border-accent"
      >
        {PRESETS.map((preset) => (
          <option key={preset.value} value={preset.value}>{preset.label}</option>
        ))}
      </select>

      {/* One field for one day. The commonest narrowing there is, so it costs one interaction. */}
      {mode === 'day' && (
        <div>
          <span className="mb-1 block text-[11px] text-ink-soft">The whole of this day</span>
          <input
            type="date"
            value={DATE_ONLY.test(value.from) ? value.from : localDay()}
            onChange={(event) => onChange({ from: event.target.value, to: event.target.value })}
            className="h-11 w-full rounded-lg border border-line bg-canvas px-2 text-sm outline-none focus:border-accent sm:h-10"
          />
        </div>
      )}

      {/* Two moments, with the time, for a window inside a day or across several. */}
      {mode === 'between' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-[11px] text-ink-soft">From</span>
            <input
              type="datetime-local"
              value={toLocalInput(value.from)}
              onChange={(event) => onChange({ ...value, from: toInstant(event.target.value) })}
              className="h-11 w-full rounded-lg border border-line bg-canvas px-2 text-sm outline-none focus:border-accent sm:h-10"
            />
          </div>
          <div>
            <span className="mb-1 block text-[11px] text-ink-soft">To</span>
            <input
              type="datetime-local"
              value={toLocalInput(value.to)}
              onChange={(event) => onChange({ ...value, to: toInstant(event.target.value) })}
              className="h-11 w-full rounded-lg border border-line bg-canvas px-2 text-sm outline-none focus:border-accent sm:h-10"
            />
          </div>
        </div>
      )}

      {mode !== 'any' && mode !== 'day' && mode !== 'between' && (
        <p className="text-[11px] text-ink-soft">
          {value.from === value.to ? `All of ${value.from}.` : `${value.from} to ${value.to}, both days included.`}
        </p>
      )}
    </div>
  );
}

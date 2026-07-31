'use client';
import { useEffect, useMemo, useState } from 'react';

// Relative/absolute time-window picker for event streams. Emits the `datetime-local`
// string format ("YYYY-MM-DDTHH:mm") both inputs and callers already use.

export type TimeUnit = 'minutes' | 'hours' | 'days' | 'months';
export type RangeMode = 'relative' | 'day' | 'between';

export interface DateTimeRangeValue {
  from: string;
  to: string;
}

interface Props {
  value: DateTimeRangeValue;
  onChange: (next: DateTimeRangeValue) => void;
  className?: string;
}

const UNIT_MS: Record<Exclude<TimeUnit, 'months'>, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

const UNIT_LABELS: Record<TimeUnit, string> = {
  minutes: 'minutes',
  hours: 'hours',
  days: 'days',
  months: 'months',
};

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ago(amount: number, unit: TimeUnit): Date {
  const now = new Date();
  if (unit === 'months') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - amount);
    return d;
  }
  return new Date(now.getTime() - amount * UNIT_MS[unit]);
}

function dayBounds(isoDay: string): DateTimeRangeValue {
  return { from: `${isoDay}T00:00`, to: `${isoDay}T23:59` };
}

function todayIso(): string {
  return toLocalInput(new Date()).slice(0, 10);
}

const PRESETS: Array<{ label: string; amount: number; unit: TimeUnit }> = [
  { label: 'Last 15 min', amount: 15, unit: 'minutes' },
  { label: 'Last hour', amount: 1, unit: 'hours' },
  { label: 'Last 24 h', amount: 24, unit: 'hours' },
  { label: 'Last 3 days', amount: 3, unit: 'days' },
  { label: 'Last 7 days', amount: 7, unit: 'days' },
  { label: 'Last 3 months', amount: 3, unit: 'months' },
];

export function DateTimeRangeFilter({ value, onChange, className = '' }: Props) {
  const [mode, setMode] = useState<RangeMode>(() => (value.from && value.to ? 'between' : 'relative'));
  const [amount, setAmount] = useState('24');
  const [unit, setUnit] = useState<TimeUnit>('hours');
  const [day, setDay] = useState(() => value.from.slice(0, 10) || todayIso());

  useEffect(() => {
    if (!value.from && !value.to && mode !== 'relative') setMode('relative');
  }, [value.from, value.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyRelative = (rawAmount: string, nextUnit: TimeUnit) => {
    setAmount(rawAmount);
    setUnit(nextUnit);
    const n = parseInt(rawAmount, 10);
    if (!n || n < 1) { onChange({ from: '', to: '' }); return; }
    onChange({ from: toLocalInput(ago(n, nextUnit)), to: '' });
  };

  const applyPreset = (p: { amount: number; unit: TimeUnit }) => {
    setMode('relative');
    applyRelative(String(p.amount), p.unit);
  };

  const applyDay = (isoDay: string) => {
    setDay(isoDay);
    onChange(isoDay ? dayBounds(isoDay) : { from: '', to: '' });
  };

  const changeMode = (next: RangeMode) => {
    setMode(next);
    if (next === 'relative') applyRelative(amount, unit);
    else if (next === 'day') applyDay(day || todayIso());
  };

  const summary = useMemo(() => {
    if (!value.from && !value.to) return 'All time.';
    if (value.from && value.to) return `${value.from.replace('T', ' ')} to ${value.to.replace('T', ' ')}.`;
    if (value.from) return `Since ${value.from.replace('T', ' ')}.`;
    return `Up to ${value.to.replace('T', ' ')}.`;
  }, [value]);

  const field = 'border border-gray-300 rounded-lg px-3 py-1.5 text-sm';

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Time window</label>
          <select value={mode} onChange={(e) => changeMode(e.target.value as RangeMode)} className={`${field} bg-white`}>
            <option value="relative">Last…</option>
            <option value="day">A single day</option>
            <option value="between">Between two dates</option>
          </select>
        </div>

        {mode === 'relative' && (
          <>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Amount</label>
              <input
                type="number" min={1} value={amount}
                onChange={(e) => applyRelative(e.target.value, unit)}
                className={`${field} w-20`}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Unit</label>
              <select
                value={unit}
                onChange={(e) => applyRelative(amount, e.target.value as TimeUnit)}
                className={`${field} bg-white`}
              >
                {(Object.keys(UNIT_LABELS) as TimeUnit[]).map((u) => (
                  <option key={u} value={u}>{UNIT_LABELS[u]}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {mode === 'day' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Day</label>
            <div className="flex items-center gap-2">
              <input type="date" value={day} onChange={(e) => applyDay(e.target.value)} className={field} />
              <button type="button" onClick={() => applyDay(todayIso())}
                className="rounded-lg border px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
                Today
              </button>
            </div>
          </div>
        )}

        {mode === 'between' && (
          <>
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input type="datetime-local" value={value.from}
                onChange={(e) => onChange({ from: e.target.value, to: value.to })} className={field} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input type="datetime-local" value={value.to} min={value.from || undefined}
                onChange={(e) => onChange({ from: value.from, to: e.target.value })} className={field} />
            </div>
          </>
        )}

        {(value.from || value.to) && (
          <button type="button" onClick={() => onChange({ from: '', to: '' })}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
            All time
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => {
          const active = mode === 'relative' && amount === String(p.amount) && unit === p.unit;
          return (
            <button key={p.label} type="button" onClick={() => applyPreset(p)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                active ? 'border-[#001E2B] bg-[#001E2B] text-[#00ED64]' : 'text-gray-600 hover:bg-gray-50 hover:border-gray-400'
              }`}>
              {p.label}
            </button>
          );
        })}
        <button type="button" onClick={() => { setMode('day'); applyDay(todayIso()); }}
          className="rounded-full border px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-400">
          Today
        </button>
        <span className="text-xs text-gray-400 ml-1">{summary}</span>
      </div>
    </div>
  );
}

export default DateTimeRangeFilter;

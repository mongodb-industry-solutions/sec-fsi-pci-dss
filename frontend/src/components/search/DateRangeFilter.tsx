'use client';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Combobox } from '../ui/Combobox';

// Reusable date-range filter for encrypted range queries (QE:range) and any other
// from/to date filter. Two native date inputs alone are not usable: it is unclear
// how to ask for a single day, and the browser calendars differ (Chrome has a
// "Today" shortcut, Firefox does not, and jumping years is painful in both).
// So the operator is explicit, common intervals are one click, and for dates of
// birth an age range replaces calendar navigation entirely.

export type DateRangeOperator = 'on' | 'before' | 'after' | 'between' | 'age';

export interface DateRangeValue {
  from: string;
  to: string;
}

interface Props {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  /** Inclusive bounds accepted by the backing index (ISO yyyy-mm-dd). */
  min?: string;
  max?: string;
  /**
   * 'birth' offers age operators and cohort presets, 'expiry' offers validity
   * presets (expired / expires soon), 'generic' offers recent-period presets.
   */
  variant?: 'birth' | 'expiry' | 'generic';
  /** Field name used in the plain-language summary, e.g. "ID expiry date". */
  fieldLabel?: string;
}

const DAY_MS = 86400000;

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return toIso(new Date());
}

function shiftDays(iso: string, days: number): string {
  return toIso(new Date(Date.parse(iso) + days * DAY_MS));
}

function shiftYears(iso: string, years: number): string {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return toIso(d);
}

/** Birth-date window for people whose age is between minAge and maxAge today. */
function ageWindow(minAge: number, maxAge: number): DateRangeValue {
  const today = todayIso();
  return {
    from: shiftDays(shiftYears(today, -(maxAge + 1)), 1),
    to: shiftYears(today, -minAge),
  };
}

function operatorOf(value: DateRangeValue): DateRangeOperator {
  if (value.from && value.to) return value.from === value.to ? 'on' : 'between';
  if (value.to) return 'before';
  if (value.from) return 'after';
  return 'on';
}

const OPERATOR_LABELS: Record<DateRangeOperator, string> = {
  on: 'On (single day)',
  before: 'On or before',
  after: 'On or after',
  between: 'Between',
  age: 'By age (years)',
};

export function DateRangeFilter({
  value,
  onChange,
  min,
  max,
  variant = 'generic',
  fieldLabel = 'date',
}: Props) {
  const [operator, setOperator] = useState<DateRangeOperator>(() => operatorOf(value));
  const [ageFrom, setAgeFrom] = useState('');
  const [ageTo, setAgeTo] = useState('');

  // Parent cleared the filter (e.g. "Clear filters"), so drop the local age inputs too.
  useEffect(() => {
    if (!value.from && !value.to) { setAgeFrom(''); setAgeTo(''); }
  }, [value.from, value.to]);

  const operators: DateRangeOperator[] = variant === 'birth'
    ? ['age', 'on', 'before', 'after', 'between']
    : ['on', 'before', 'after', 'between'];

  const clamp = (iso: string): string => {
    if (!iso) return iso;
    if (min && iso < min) return min;
    if (max && iso > max) return max;
    return iso;
  };

  const emit = (next: DateRangeValue) => onChange({ from: clamp(next.from), to: clamp(next.to) });

  const changeOperator = (next: DateRangeOperator) => {
    setOperator(next);
    // Carry the date the operator already has, so switching does not lose the input.
    const anchor = value.from || value.to;
    if (next === 'age') { emit({ from: '', to: '' }); return; }
    if (!anchor) return;
    if (next === 'on') emit({ from: anchor, to: anchor });
    else if (next === 'before') emit({ from: '', to: anchor });
    else if (next === 'after') emit({ from: anchor, to: '' });
  };

  const setSingle = (iso: string) => {
    if (operator === 'on') emit({ from: iso, to: iso });
    else if (operator === 'before') emit({ from: '', to: iso });
    else emit({ from: iso, to: '' });
  };

  const applyAge = (lo: string, hi: string) => {
    setAgeFrom(lo);
    setAgeTo(hi);
    const loN = lo === '' ? 0 : Number(lo);
    const hiN = hi === '' ? 120 : Number(hi);
    if (isNaN(loN) || isNaN(hiN) || loN > hiN) { emit({ from: '', to: '' }); return; }
    emit(ageWindow(loN, hiN));
  };

  const presets = useMemo((): Array<{ label: string; title: string; apply: () => void }> => {
    const today = todayIso();
    if (variant === 'birth') {
      const cohort = (label: string, lo: number, hi: number, title: string) => ({
        label, title, apply: () => { setOperator('age'); applyAge(String(lo), String(hi)); },
      });
      return [
        cohort('Minors (under 18)', 0, 17, 'Customers who are not of age today: a KYC/AML exception worth auditing'),
        cohort('18-25', 18, 25, 'Young adults'),
        cohort('26-40', 26, 40, 'Adults 26 to 40'),
        cohort('41-65', 41, 65, 'Adults 41 to 65'),
        cohort('Over 65', 66, 120, 'Customers over 65'),
      ];
    }
    if (variant === 'expiry') {
      return [
        { label: 'Already expired', title: 'Documents whose expiry date has passed', apply: () => { setOperator('before'); emit({ from: '', to: shiftDays(today, -1) }); } },
        { label: 'Expires today', title: 'Documents expiring on today\'s date', apply: () => { setOperator('on'); emit({ from: today, to: today }); } },
        { label: 'Next 30 days', title: 'Documents expiring within 30 days', apply: () => { setOperator('between'); emit({ from: today, to: shiftDays(today, 30) }); } },
        { label: 'Next 90 days', title: 'Documents expiring within 90 days', apply: () => { setOperator('between'); emit({ from: today, to: shiftDays(today, 90) }); } },
        { label: 'Valid over 1 year', title: 'Documents valid for more than one year', apply: () => { setOperator('after'); emit({ from: shiftYears(today, 1), to: '' }); } },
      ];
    }
    return [
      { label: 'Today', title: 'Only today', apply: () => { setOperator('on'); emit({ from: today, to: today }); } },
      { label: 'Last 7 days', title: 'The last seven days', apply: () => { setOperator('between'); emit({ from: shiftDays(today, -7), to: today }); } },
      { label: 'Last 30 days', title: 'The last thirty days', apply: () => { setOperator('between'); emit({ from: shiftDays(today, -30), to: today }); } },
      { label: 'This year', title: 'From the 1st of January to today', apply: () => { setOperator('between'); emit({ from: `${today.slice(0, 4)}-01-01`, to: today }); } },
    ];
  }, [variant, min, max]); // eslint-disable-line react-hooks/exhaustive-deps

  // Plain-language recap so the operator always knows what the query asks for.
  const summary = useMemo(() => {
    const { from, to } = value;
    if (!from && !to) return `Pick a ${fieldLabel.toLowerCase()} to search. Both ends are inclusive.`;
    if (from && to && from === to) return `${fieldLabel} exactly on ${from}.`;
    if (from && to) return `${fieldLabel} from ${from} to ${to}, both included.`;
    if (to) return `${fieldLabel} on or before ${to}.`;
    return `${fieldLabel} on or after ${from}.`;
  }, [value, fieldLabel]);

  const inputClass = 'border rounded-lg px-3 py-2 text-sm';
  const singleValue = operator === 'before' ? value.to : value.from;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52">
          <label className="block text-xs font-medium text-gray-600 mb-1">Condition</label>
          <Combobox
            editable={false}
            value={operator}
            onChange={(v) => changeOperator(v as DateRangeOperator)}
            inputClassName="py-2"
            options={operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
          />
        </div>

        {operator === 'age' ? (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Age from</label>
              <input
                type="number" min={0} max={120} value={ageFrom} placeholder="0"
                onChange={(e) => applyAge(e.target.value, ageTo)}
                className={`${inputClass} w-24`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Age to</label>
              <input
                type="number" min={0} max={120} value={ageTo} placeholder="120"
                onChange={(e) => applyAge(ageFrom, e.target.value)}
                className={`${inputClass} w-24`}
              />
            </div>
          </>
        ) : operator === 'between' ? (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <input
                type="date" value={value.from} min={min} max={max}
                onChange={(e) => emit({ from: e.target.value, to: value.to })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <input
                type="date" value={value.to} min={value.from || min} max={max}
                onChange={(e) => emit({ from: value.from, to: e.target.value })}
                className={inputClass}
              />
            </div>
          </>
        ) : (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
            <div className="flex items-center gap-2">
              <input
                type="date" value={singleValue} min={min} max={max}
                onChange={(e) => setSingle(e.target.value)}
                className={inputClass}
              />
              {/* Own "Today" button: Chrome's picker has one, Firefox's does not. */}
              <button
                type="button"
                onClick={() => setSingle(clamp(todayIso()))}
                title="Use today's date"
                className="inline-flex items-center gap-1 rounded-lg border px-2 py-2 text-xs text-gray-600 hover:bg-gray-50"
              >
                <CalendarDays size={13} /> Today
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-400 mr-1">Quick:</span>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={p.apply}
            title={p.title}
            className="rounded-full border px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-500">
        {summary}
        {(min || max) && (
          <span className="text-gray-400"> Searchable range: {min ?? '·'} to {max ?? '·'}.</span>
        )}
      </p>
    </div>
  );
}

export default DateRangeFilter;

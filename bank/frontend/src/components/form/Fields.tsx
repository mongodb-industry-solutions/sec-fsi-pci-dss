'use client';
import { useId, useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { AdminError } from '../../lib/adminClient';

// The form controls, once.
//
// Every form in this app is built from these: opening an account, issuing a card, setting a limit, editing a
// capability's rules. They exist as one set because the alternative was visible in the first version of this
// app, where the rules screens were a textarea holding raw JSON. That is not a form: it puts the burden of
// remembering the field names and the valid values on the operator, and it turns a typo into a 400 from the
// bank instead of a control that could not express the mistake.
//
// Each control is responsive by construction: the label sits above the input below `sm` and beside it from
// there, and every input is at least 44px tall so a phone can hit it.

function rowClass(): string {
  return 'grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-center sm:gap-4';
}

function inputClass(): string {
  return 'h-11 w-full rounded-lg border border-line bg-canvas px-3 text-sm outline-none transition focus:border-accent sm:h-10';
}

function Label({ htmlFor, label, hint }: { htmlFor: string; label: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="min-w-0">
      <span className="block text-sm">{label}</span>
      {hint && <span className="mt-0.5 block text-pretty text-[11px] leading-relaxed text-ink-soft">{hint}</span>}
    </label>
  );
}

export function TextField({
  label, value, onChange, hint, placeholder, mono, required, maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div className={rowClass()}>
      <Label htmlFor={id} label={label} hint={hint} />
      <input
        id={id}
        value={value}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass()} ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}

export function NumberField({
  label, value, onChange, hint, min, max, step, suffix,
}: {
  label: string;
  value: number | '';
  onChange: (value: number | '') => void;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const id = useId();
  return (
    <div className={rowClass()}>
      <Label htmlFor={id} label={label} hint={hint} />
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
          className={inputClass()}
        />
        {suffix && <span className="shrink-0 text-xs text-ink-soft">{suffix}</span>}
      </div>
    </div>
  );
}

export function SelectField({
  label, value, onChange, options, hint, placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className={rowClass()}>
      <Label htmlFor={id} label={label} hint={hint} />
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass()}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

export function ToggleField({
  label, value, onChange, hint,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className={rowClass()}>
      <Label htmlFor={id} label={label} hint={hint} />
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
          value ? 'border-accent bg-accent/80' : 'border-line bg-surface-alt'
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-canvas shadow transition ${value ? 'translate-x-6' : 'translate-x-1'}`}
        />
        <span className="sr-only">{value ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

/**
 * A list of short strings: the accepted networks, the payment products this bank offers.
 *
 * A comma-separated text box would be simpler and would also be the thing that silently accepts a trailing
 * comma as an empty entry. Chips make each value a value.
 */
export function ListField({
  label, value, onChange, hint, placeholder, uppercase,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint?: string;
  placeholder?: string;
  uppercase?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');

  function add() {
    const entry = uppercase ? draft.trim().toUpperCase() : draft.trim();
    if (!entry || value.includes(entry)) { setDraft(''); return; }
    onChange([...value, entry]);
    setDraft('');
  }

  return (
    <div className={rowClass()}>
      <Label htmlFor={id} label={label} hint={hint} />
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            id={id}
            value={draft}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
            className={inputClass()}
          />
          <button
            type="button"
            onClick={add}
            aria-label={`Add to ${label}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-ink-soft transition hover:border-accent hover:text-ink sm:h-10 sm:w-10"
          >
            <Plus size={16} aria-hidden />
          </button>
        </div>
        {value.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {value.map((entry) => (
              <li key={entry}>
                <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-alt py-1 pl-2.5 pr-1 text-xs">
                  <span className="font-mono">{entry}</span>
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((kept) => kept !== entry))}
                    aria-label={`Remove ${entry}`}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-ink-soft hover:bg-red-500/10 hover:text-red-600"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The shell every form sits in: a submit that cannot be pressed twice, the bank's own refusal shown in full,
 * and a save button that is DISABLED until something actually changed.
 *
 * That last property is the one worth keeping. A form whose save is always live invites a save that writes
 * back exactly what was read, and on a configuration record that is indistinguishable in the audit trail from
 * a deliberate change.
 */
export function FormShell({
  children, onSubmit, dirty, submitLabel, onReset, note,
}: {
  children: React.ReactNode;
  onSubmit: () => Promise<unknown>;
  dirty: boolean;
  submitLabel: string;
  onReset?: () => void;
  note?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSubmit();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (cause) {
      setError(cause instanceof AdminError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="divide-y divide-line">{children}</div>

      {note && <p className="text-pretty text-[11px] leading-relaxed text-ink-soft">{note}</p>}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Sticks to the bottom of the viewport on a phone, where a long form would otherwise put the save
          button below the fold and out of reach without scrolling the whole thing. */}
      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-3">
        <button
          type="submit"
          disabled={busy || !dirty}
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-accent bg-accent px-4 text-sm text-canvas transition hover:opacity-90 disabled:opacity-40 sm:h-9"
        >
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {submitLabel}
        </button>
        {onReset && dirty && (
          <button type="button" onClick={onReset} className="text-xs text-ink-soft hover:text-ink">
            Discard the changes
          </button>
        )}
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Check size={14} aria-hidden /> Saved
          </span>
        )}
        {!dirty && !saved && <span className="text-xs text-ink-soft">Nothing has changed yet.</span>}
      </div>
    </form>
  );
}

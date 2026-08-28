'use client';
import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

// A value that is encrypted at rest, shown only when an operator asks for it.
//
// The mask is what renders by default and the plaintext is never in the page until the eye is clicked, because
// this component fetches it at that moment rather than receiving it and hiding it with CSS. That distinction is
// the whole point: a hidden field is still in the response, still in the browser's memory and still in anything
// that captures the page, whereas a value that was never sent cannot leak from here.
//
// Clicking again discards it. It lives in this component's state for as long as it is shown and nowhere else:
// not in a store, not in the URL, not in local storage.

export function Reveal({
  label, masked, fetchValue, hint, disabled,
}: {
  label: string;
  masked?: string;
  /** Resolves the plaintext on demand. Called on each reveal, never cached across them. */
  fetchValue: () => Promise<string>;
  hint?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = value !== null;

  async function toggle() {
    if (shown) {
      setValue(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setValue(await fetchValue());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    // Stacks below `sm` so a revealed card number or IBAN never widens the layout or pushes the eye off the
    // screen. A long value that forces a horizontal scroll is a value an operator cannot read.
    <div className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="shrink-0 text-xs text-ink-soft">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        {hint && <span className="hidden font-mono text-[11px] text-ink-soft sm:inline">{hint}</span>}
        <span className="min-w-0 break-all font-mono text-sm sm:text-right">
          {error
            ? <span className="font-sans text-xs text-red-600 dark:text-red-400">{error}</span>
            : shown ? value : (masked || '••••')}
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={disabled || loading}
          title={shown ? `Hide the ${label.toLowerCase()}` : `Reveal the ${label.toLowerCase()}`}
          aria-label={shown ? `Hide the ${label.toLowerCase()}` : `Reveal the ${label.toLowerCase()}`}
          aria-pressed={shown}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-alt hover:text-accent disabled:opacity-40"
        >
          {loading
            ? <Loader2 size={15} className="animate-spin" aria-hidden />
            : shown ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
        </button>
      </span>
    </div>
  );
}

/** A plain row, so a detail panel's ordinary fields and its revealable ones line up. */
export function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="shrink-0 text-xs text-ink-soft">{label}</span>
      <span className={`min-w-0 break-words text-sm sm:text-right ${mono ? 'font-mono' : ''}`}>
        {children === '' || children === null || children === undefined
          ? <span className="text-ink-soft">not set</span>
          : children}
      </span>
    </div>
  );
}

/** The card every detail panel sits in, so the sections on a detail page are visually one family. */
export function Panel({ title, description, children, actions }: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-pretty text-xs leading-relaxed text-ink-soft">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

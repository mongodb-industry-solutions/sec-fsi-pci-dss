'use client';
import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { AdminError } from '../../lib/adminClient';

// A button that changes something at the bank.
//
// Three things every such button needs, and which get forgotten when each screen writes its own: it cannot be
// pressed twice while the first press is in flight, it shows the bank's REFUSAL rather than a generic failure,
// and a destructive one asks first. The refusal text matters most: "the account still holds 240.00 EUR and
// cannot be closed until it is empty" tells an operator what to do next, and "request failed" does not.

export function Action({
  label, run, onDone, confirm, tone = 'normal', disabled, title,
}: {
  label: string;
  run: () => Promise<unknown>;
  onDone?: () => void;
  /** Asked before running. Present for anything terminal: revoking a card, closing an account. */
  confirm?: string;
  tone?: 'normal' | 'primary' | 'danger';
  disabled?: boolean;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function perform() {
    setBusy(true);
    setError(null);
    setAsking(false);
    try {
      await run();
      onDone?.();
    } catch (cause) {
      setError(cause instanceof AdminError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const styles = {
    primary: 'border-accent bg-accent text-canvas hover:opacity-90',
    danger: 'border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400',
    normal: 'border-line text-ink-soft hover:border-accent hover:text-ink',
  }[tone];

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        title={title}
        disabled={disabled || busy}
        onClick={() => (confirm && !asking ? setAsking(true) : perform())}
        // 44px on a phone: a destructive action behind a 28px target is one a thumb hits by accident.
        className={`inline-flex h-11 items-center gap-2 rounded-lg border px-3 text-sm transition disabled:opacity-40 sm:h-9 ${styles}`}
      >
        {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
        {asking ? 'Confirm' : label}
      </button>

      {asking && (
        <span className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            {confirm}
            <button type="button" onClick={() => setAsking(false)} className="ml-2 underline">Cancel</button>
          </span>
        </span>
      )}

      {error && (
        <span className="max-w-xs break-words rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[11px] leading-relaxed text-red-700 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}

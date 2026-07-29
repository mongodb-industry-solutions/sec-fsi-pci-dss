'use client';
import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Tooltip } from './Tooltip';

// Shared on-demand reveal for a sensitive value (CVV, full PAN, IBAN). The value is HIDDEN by
// default: only the masked display (if any) is shown. Clicking the eye fetches the ephemeral value
// on demand; clicking again hides and discards it. The value is never persisted or logged; it lives
// in component state only for as long as it is shown. PCI DSS Req 3.2/3.3 (CHD), GDPR (IBAN/PII).
export function SensitiveReveal({
  label,
  masked,
  fetchValue,
  disabled,
  hint,
  info,
}: {
  label: string;
  masked?: string;
  // Resolves the ephemeral plaintext on demand. Errors are surfaced inline.
  fetchValue: () => Promise<string>;
  disabled?: boolean;
  hint?: string;
  // v32 D1: per-field help, same contract as RecordField, so a sensitive row explains itself too.
  info?: string;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = value !== null;

  async function toggle() {
    if (shown) { setValue(null); setError(null); return; } // hide + discard
    setLoading(true);
    setError(null);
    try {
      setValue(await fetchValue());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reveal');
    } finally {
      setLoading(false);
    }
  }

  return (
    // v32 P8: stacks on small viewports so a revealed long value (full PAN, IBAN) never widens
    // the layout or pushes the eye out of the viewport.
    <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span className="flex items-center gap-1.5 text-gray-500 shrink-0">{label}{info && <Tooltip text={info} />}</span>
      <span className="flex items-center gap-2 min-w-0">
        {hint && <span className="text-xs text-gray-300 font-mono hidden sm:inline">{hint}</span>}
        <span className="text-gray-800 sm:text-right font-mono truncate">
          {error ? <span className="text-red-500 text-xs font-sans">{error}</span>
            : shown ? value
            : (masked ?? '••••')}
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={disabled || loading}
          title={shown ? `Hide ${label}` : `Reveal ${label}`}
          aria-label={shown ? `Hide ${label}` : `Reveal ${label}`}
          aria-pressed={shown}
          className="p-1.5 rounded text-gray-400 hover:text-[#001E2B] hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : shown ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </span>
    </div>
  );
}

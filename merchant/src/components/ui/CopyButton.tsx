'use client';
// Small copy-to-clipboard affordance. Copies the FULL value (not the truncated
// display), with a brief "Copied" confirmation and an accessible label. Used for
// internal references (e.g. a payment execution reference) that investigators need
// to extract. Never used for CHD, which is out of scope for this merchant app.
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CopyButton({
  value,
  label = 'Copy',
  className = '',
}: {
  value: string;
  /** Describes what is copied, e.g. "transaction ID". Used in the aria-label. */
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback for non-secure contexts / older browsers.
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* nothing else we can do */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
  }

  return (
    <button
      type="button"
      onClick={copy}
      // Reset the confirmation on interaction end (no timers → no unmount/stale-closure races).
      onMouseLeave={() => setCopied(false)}
      onBlur={() => setCopied(false)}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      title={value}
      className={`inline-flex items-center gap-1 rounded-md p-1 text-muted transition hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden />
          <span className="text-[10px] font-medium text-[var(--ok)]">Copied</span>
        </>
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}

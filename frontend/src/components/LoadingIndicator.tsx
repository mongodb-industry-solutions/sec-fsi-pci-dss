'use client';
import { Loader2 } from 'lucide-react';

// Reusable loading indicator: an animated spinner with an optional label. Use it wherever a
// request may take a moment so the user always knows something is happening (e.g. QE searches
// that round-trip to Atlas). `inline` renders compactly next to other content; the default is a
// centered block suited to empty result areas.
interface Props {
  label?: string;
  inline?: boolean;
  size?: number;
  className?: string;
}

export function LoadingIndicator({ label = 'Loading…', inline = false, size = 16, className = '' }: Props) {
  if (inline) {
    return (
      <span className={`inline-flex items-center gap-2 text-sm text-gray-500 ${className}`} role="status" aria-live="polite">
        <Loader2 size={size} className="animate-spin text-[#00684A]" />
        {label}
      </span>
    );
  }
  return (
    <div className={`flex items-center justify-center gap-2 py-8 text-sm text-gray-500 ${className}`} role="status" aria-live="polite">
      <Loader2 size={size} className="animate-spin text-[#00684A]" />
      {label}
    </div>
  );
}

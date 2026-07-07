'use client';
// Route-level error boundary (keeps the app shell; complements global-error.tsx).
// Intentionally dependency-free (no icon imports) so the boundary itself can never fail
// to render because of a missing module.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--err)_35%,transparent)] bg-[var(--err-bg)] p-6">
      <span aria-hidden className="mt-0.5 text-[var(--err)]">⚠</span>
      <div>
        <h2 className="font-semibold text-[var(--err)]">Something went wrong</h2>
        <p className="mt-1 text-sm text-ink/80">This page hit an unexpected error.</p>
        <button onClick={() => reset()} className="btn-primary mt-3 text-sm">Try again</button>
      </div>
    </div>
  );
}

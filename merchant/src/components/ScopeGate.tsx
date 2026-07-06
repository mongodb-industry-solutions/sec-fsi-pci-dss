// Graceful degradation (E-12): friendly notices instead of broken pages.
import { Lock, TriangleAlert } from 'lucide-react';

export function ScopeMissing({ scope }: { scope: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-[var(--warn-bg)] p-6">
      <Lock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--warn)]" aria-hidden />
      <div>
        <h2 className="font-semibold text-[var(--warn)]">Permission not granted</h2>
        <p className="mt-1 text-sm text-ink/80">
          This feature needs the <code className="rounded bg-surface px-1 font-mono">{scope}</code> permission, which you
          did not grant to Espresso Works. You can{' '}
          <a href="/api/auth/login" className="font-medium text-leaf-deep underline">re-authorise</a> to enable it.
        </p>
      </div>
    </div>
  );
}

export function PspUnavailable({ message }: { message?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--err)_35%,transparent)] bg-[var(--err-bg)] p-6">
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--err)]" aria-hidden />
      <div>
        <h2 className="font-semibold text-[var(--err)]">Not available</h2>
        <p className="mt-1 text-sm text-ink/80">{message ?? 'The PSP declined this request or is unreachable.'}</p>
      </div>
    </div>
  );
}

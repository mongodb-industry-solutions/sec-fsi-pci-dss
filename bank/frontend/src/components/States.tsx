import { AlertTriangle, Inbox } from 'lucide-react';

// The two states every screen here needs, said the same way each time.
//
// The distinction matters more than it looks: an unreachable bank and an empty result look identical if both
// render as a blank page, and an operator will read the blank one as "there is no data".

export function BankError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-red-800 dark:text-red-300">The bank did not answer</p>
        <p className="mt-1 break-words text-xs text-red-700 dark:text-red-400">{message}</p>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-sm text-ink-soft">
      <Inbox size={18} className="shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

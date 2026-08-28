// One status vocabulary, coloured the same way on every screen.
//
// The tones say what the status MEANS rather than being decorative: green is in use, blue is waiting for
// somebody, amber is stopped but recoverable, red is terminal. An operator scanning a page of rows reads the
// colour before the word, so a status that looks the same as its opposite is worse than no colour at all.

const TONE: Record<string, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  valid: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  delivered: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  issued: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  pending_approval: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  received: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  suspended: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  blocked: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  dormant: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  revoked: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  closed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  rejected: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = TONE[status] ?? 'border-line bg-surface-alt text-ink-soft';
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

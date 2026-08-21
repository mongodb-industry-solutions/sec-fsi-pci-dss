// Evidence export: write a scoped, self-describing JSON extract to a file. Auditors work from a
// bounded set with the filters and the moment of extraction attached, not from a screenshot.

export interface EvidenceEnvelope<T> {
  filtersApplied: Record<string, unknown>;
  totalMatching: number;
  records: T[];
  [extra: string]: unknown;
}

export function downloadJsonFile(baseName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Drops empty/default filter values so the extract states only what was actually applied. */
export function appliedFilters(filters: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined && v !== '' && v !== 'all'),
  );
}

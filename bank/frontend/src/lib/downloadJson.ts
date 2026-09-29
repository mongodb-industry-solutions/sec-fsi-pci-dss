'use client';

// Taking a set of records out of the bank as JSON, for analysis somewhere else.
//
// An export is an extract, so it says what it is: when it was taken, which filters produced it, how many
// records matched and how many were written. Without those, a file of 500 rows read later is indistinguishable
// from the complete set, and someone will read a truncated extract as the whole picture.

export interface Extract {
  generatedAt: string;
  resource: string;
  filtersApplied: Record<string, unknown>;
  totalMatching: number;
  exported: number;
  truncated: boolean;
  records: unknown[];
}

export function buildExtract(
  resource: string,
  filters: Record<string, unknown>,
  records: unknown[],
  totalMatching: number,
): Extract {
  return {
    generatedAt: new Date().toISOString(),
    resource,
    filtersApplied: Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== '' && value !== null),
    ),
    totalMatching,
    exported: records.length,
    truncated: records.length < totalMatching,
    records,
  };
}

export function downloadJsonFile(baseName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${baseName}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

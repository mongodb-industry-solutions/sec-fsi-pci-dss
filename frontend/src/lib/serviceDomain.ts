// BIAN service-domain labels reach the UI from backend control records, which prefix the readable
// name with a service-domain code. The stored value keeps the code for traceability; the UI shows
// the name only, since a bare code confuses demo audiences and a stale one reads as a factual error.
export function serviceDomainLabel(value?: string | null): string {
  if (!value) return '';
  return value.replace(/\bSD-\d+\b\s*/g, '').replace(/\s{2,}/g, ' ').trim();
}

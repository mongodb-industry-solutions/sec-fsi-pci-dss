// BIAN service-domain labels reach the UI from backend control records (e.g. "SD-66 Payout Account
// Arrangement"). The stored value keeps its code for traceability; the UI shows only the readable
// name, since a bare "SD-##" confuses demo audiences and any stale code reads as a factual error.
export function serviceDomainLabel(value?: string | null): string {
  if (!value) return '';
  return value.replace(/\bSD-\d+\b\s*/g, '').replace(/\s{2,}/g, ' ').trim();
}

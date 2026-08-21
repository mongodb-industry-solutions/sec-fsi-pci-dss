// Display helpers shared by every record view.

// Known short acronyms stay upper-case when humanizing enum/snake_case values.
const ACRONYMS = new Set([
  'sme', 'id', 'vat', 'ssn', 'kyc', 'kyb', 'ubo', 'pep', 'usd', 'eur', 'gbp', 'us', 'uk', 'eu',
]);

/** 'personal_banking' to 'Personal Banking', 'sme' to 'SME'. Empty string for null/undefined. */
export function humanize(v: unknown): string {
  const s = v == null ? '' : String(v).trim();
  if (!s) return '';
  return s.split(/[_\-\s]+/).filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** One-line rendering of a BIAN address sub-document. */
export function fmtAddress(a: unknown): string {
  if (!a || typeof a !== 'object') return '';
  const o = a as Record<string, unknown>;
  return [o.streetAddress ?? o.line1, o.line2, o.city, o.postalCode, o.countryCode]
    .map((v) => (v == null ? '' : String(v))).filter(Boolean).join(', ');
}

/** ISO date or date-time to YYYY-MM-DD. Empty string when absent. */
export function fmtDate(v: unknown): string {
  return v ? String(v).slice(0, 10) : '';
}

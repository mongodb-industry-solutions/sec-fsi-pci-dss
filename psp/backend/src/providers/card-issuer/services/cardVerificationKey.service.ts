// Expiry formatting for the card-issuer capability.
//
// v37 P7 moved the key material and the derivation to the bank: a card verification value is derived from
// issuer data under an issuer key, so only the issuer can compute one, and holding a copy of that key here
// would put the PSP back in scope for what P7 removed. What remains is the pure formatting the PSP needs to
// state an expiry the same way the issuer will read it.

/** Normalises an expiry to MMYY. Accepts MM/YY or MM/YYYY. */
export function normalizeExpiry(expiry: string): string {
  const match = (expiry ?? '').trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!match) return (expiry ?? '').replace(/\D/g, '').slice(0, 4);
  const month = match[1].padStart(2, '0');
  const year = match[2].length === 4 ? match[2].slice(2) : match[2];
  return `${month}${year}`;
}

// The service code assumed when a card carries none. Kept here because the PSP quotes it when asking the
// issuer, but the issuer's own record wins whenever it has one.
export const DEFAULT_SERVICE_CODE = '201';

// v17.1 Bank Transfer: pure banking-coordinate validators (no I/O, fully testable).
// Standards: ISO 13616 (IBAN mod-97), ISO 9362 (BIC), NACHA/ABA routing checksum.
// Reused by RailResolver, the API preview endpoint and the frontend contract. DRY: one implementation.

const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20,
  ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27,
  LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25,
  RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

/** Normalise an IBAN/BIC: strip spaces, upper-case. */
export function normalise(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** ISO 13616 IBAN validation: structure, per-country length and mod-97 check. */
export function isValidIban(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const iban = normalise(raw);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const country = iban.slice(0, 2);
  const expected = IBAN_LENGTHS[country];
  if (expected && iban.length !== expected) return false;

  // Move the first 4 chars to the end, then convert letters to numbers (A=10..Z=35).
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));

  // mod-97 over a long numeric string, processed in chunks to avoid overflow.
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(String(remainder) + numeric.slice(i, i + 7)) % 97;
  }
  return remainder === 1;
}

/** Country code (ISO 3166-1 alpha-2) extracted from an IBAN, or undefined. */
export function ibanCountry(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const iban = normalise(raw);
  return /^[A-Z]{2}/.test(iban) ? iban.slice(0, 2) : undefined;
}

/** ISO 9362 BIC: 8 or 11 chars, 4 bank, 2 country, 2 location, optional 3 branch. */
export function isValidBic(raw: string | undefined | null): boolean {
  if (!raw) return false;
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalise(raw));
}

/** NACHA/ABA routing number: 9 digits with the standard weighted checksum. */
export function isValidRoutingNumber(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const rn = raw.replace(/\s+/g, '');
  if (!/^[0-9]{9}$/.test(rn)) return false;
  const d = rn.split('').map(Number);
  const checksum =
    3 * (d[0] + d[3] + d[6]) +
    7 * (d[1] + d[4] + d[7]) +
    1 * (d[2] + d[5] + d[8]);
  return checksum % 10 === 0;
}

// Masking the values that are encrypted at rest, in one place.
//
// The rule this enforces: nothing encrypted leaves the bank in the clear unless the caller asked for it as a
// disclosure. A list is the dangerous case, because one request would otherwise decrypt a page of names, so
// every list here masks and the full value is its own recorded act.
//
// A mask shows SHAPE, not content: enough to recognise a record you already know, not enough to learn one you
// do not. It is deliberately not reversible and deliberately not a hash, since an operator has to be able to
// look at it.

const DOT = '•';

/** Keeps each word's initial, so "Ana Maria Lopez" stays recognisable as three words beginning A, M, L. */
export function maskName(name: string): string {
  if (!name) return '';
  return name
    .split(/\s+/)
    .map((part) => (part.length <= 1 ? part : `${part[0]}${DOT.repeat(Math.min(part.length - 1, 6))}`))
    .join(' ');
}

/** Keeps the domain, which is not the identifying part, and hides the local part that is. */
export function maskEmail(email: string): string {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return DOT.repeat(email.length);
  return `${local.slice(0, 1)}${DOT.repeat(Math.max(1, Math.min(local.length - 1, 6)))}@${domain}`;
}

/** Keeps the country and check digits and the last four, which is what appears on a statement. */
export function maskIban(iban: string): string {
  if (!iban) return '';
  if (iban.length <= 8) return DOT.repeat(iban.length);
  return `${iban.slice(0, 4)}${DOT.repeat(Math.min(iban.length - 8, 14))}${iban.slice(-4)}`;
}

import { BankProfileControlRecord, BinRange } from '../models/bankProfile.model';

// Derivation of "does this bank own this account or card" from the identifiers the industry already
// uses. No invented field: the IBAN carries its national bank code, and the PAN starts with the
// issuer identification number.
//
// This is the path a freshly entered IBAN or PAN takes, before any link record exists. A linked
// account or card stores the bank reference, so routing is a lookup instead of a derivation.

export function normalizeIban(iban: string): string {
  return iban.replace(/[\s-]/g, '').toUpperCase();
}

// The national bank identifier's position and length are country specific. Only the countries the
// demo issues in are listed; an unlisted country returns null rather than a guess, because guessing
// would silently route a payment to the wrong institution.
const IBAN_BANK_CODE_LENGTH: Record<string, number> = {
  ES: 4, FR: 5, DE: 8, NL: 4, IE: 6, PT: 4, BE: 3, IT: 5, AT: 5, FI: 6, GB: 4,
};

export function ibanBankCode(iban: string): string | null {
  const normalized = normalizeIban(iban);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(normalized)) return null;
  const length = IBAN_BANK_CODE_LENGTH[normalized.slice(0, 2)];
  if (!length) return null;
  const code = normalized.slice(4, 4 + length);
  return code.length === length ? code : null;
}

// ISO 13616 check digits. Validated on both sides: the TPP validates to fail fast, the bank
// re-validates because it never trusts the client.
export function isValidIban(iban: string): boolean {
  const normalized = normalizeIban(iban);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{6,30}$/.test(normalized)) return false;
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

export function panBin(pan: string): string | null {
  const digits = pan.replace(/\D/g, '');
  return digits.length >= 6 ? digits.slice(0, 6) : null;
}

function binInRange(bin: string, range: BinRange): boolean {
  const width = range.binRangeFrom.length;
  const candidate = bin.slice(0, width);
  return candidate >= range.binRangeFrom && candidate <= range.binRangeTo;
}

export function ownsIban(profile: BankProfileControlRecord, iban: string): boolean {
  const code = ibanBankCode(iban);
  return code !== null && profile.bankProfileIbanBankCodes.includes(code);
}

export function ownsBic(profile: BankProfileControlRecord, bic: string): boolean {
  // A BIC is 8 or 11 characters; the 8 character form is the same institution without the branch.
  const normalized = bic.replace(/\s/g, '').toUpperCase();
  const own = profile.bankProfileBic.toUpperCase();
  return normalized === own || normalized.slice(0, 8) === own.slice(0, 8);
}

export function ownsPan(profile: BankProfileControlRecord, pan: string): boolean {
  const bin = panBin(pan);
  return bin !== null && profile.bankProfileBinRanges.some((range) => binInRange(bin, range));
}

export type IdentifierRefusal = { owned: false; reason: string };
export type IdentifierMatch = { owned: true; matchedOn: 'iban' | 'bic' | 'bin' };

// An identifier that matches nothing is refused with a reason. There is no default bank: routing to
// one would send money to an institution the user never named.
export function resolveAccountOwnership(
  profile: BankProfileControlRecord,
  input: { iban?: string; bic?: string },
): IdentifierMatch | IdentifierRefusal {
  if (input.iban) {
    if (!isValidIban(input.iban)) return { owned: false, reason: 'iban_check_digits_invalid' };
    if (ownsIban(profile, input.iban)) return { owned: true, matchedOn: 'iban' };
    const code = ibanBankCode(input.iban);
    return { owned: false, reason: code ? 'iban_bank_code_not_registered' : 'iban_country_not_supported' };
  }
  if (input.bic) {
    if (ownsBic(profile, input.bic)) return { owned: true, matchedOn: 'bic' };
    return { owned: false, reason: 'bic_not_registered' };
  }
  return { owned: false, reason: 'no_account_identifier_supplied' };
}

export function resolveCardOwnership(
  profile: BankProfileControlRecord,
  pan: string,
): IdentifierMatch | IdentifierRefusal {
  const bin = panBin(pan);
  if (!bin) return { owned: false, reason: 'pan_too_short_for_a_bin' };
  if (ownsPan(profile, pan)) return { owned: true, matchedOn: 'bin' };
  return { owned: false, reason: 'bin_not_issued_by_this_bank' };
}

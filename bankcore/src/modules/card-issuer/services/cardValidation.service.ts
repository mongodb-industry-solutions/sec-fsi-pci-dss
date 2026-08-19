import { Db } from 'mongodb';
import { resolveModuleConfig } from '../../admin/services/bankModuleConfiguration.service';

// The issuer deciding whether a card is genuine: format, network, expiry and CVV.
//
// It lives at the bank because that is where the PAN lives, and because a verification value is derived from
// issuer data nobody else holds. Every rule is configuration, not a constant: the accepted CVV, the mode,
// the Luhn requirement and the supported networks are read per call from the record the admin API edits.

export interface CardNetworkRule {
  name: string;
  // Exact leading digits ("4") or an inclusive range over them ("51-55", "2221-2720").
  prefixes: string[];
  lengths: number[];
  cvvLength: number;
  enabled: boolean;
}

// `global`: the configured escape hatch only. `per_card`: the derived value only, the realistic case.
// `both`: either, which keeps the demo workable while still exercising the derivation.
export type CvvMode = 'both' | 'global' | 'per_card';

export interface CardIssuerConfig {
  // The global bypass code, edited at runtime through the admin API and never hardcoded.
  validCvv: string;
  cvvMode: CvvMode;
  enforceLuhn: boolean;
  verifyCardholderName: boolean;
  networks: CardNetworkRule[];
}

// Seed defaults, not the acceptance rule: each is overridden by the stored configuration. Change the
// accepted CVV in the admin API, never here.
export const DEFAULT_CARD_ISSUER_CONFIG: CardIssuerConfig = {
  validCvv: '123',
  cvvMode: 'both',
  enforceLuhn: true,
  verifyCardholderName: false,
  networks: [
    { name: 'VISA', prefixes: ['4'], lengths: [13, 16, 19], cvvLength: 3, enabled: true },
    { name: 'MASTERCARD', prefixes: ['51-55', '2221-2720'], lengths: [16], cvvLength: 3, enabled: true },
    { name: 'AMEX', prefixes: ['34', '37'], lengths: [15], cvvLength: 4, enabled: true },
    { name: 'DISCOVER', prefixes: ['6011', '644-649', '65'], lengths: [16, 19], cvvLength: 3, enabled: true },
  ],
};

/** Reads the live configuration per call, so an admin change takes effect without a restart. */
export async function cardIssuerConfig(db: Db): Promise<CardIssuerConfig> {
  // Cast at this one boundary, rather than making the config type indexable for every caller.
  const merged = await resolveModuleConfig(
    db, 'card-issuer', DEFAULT_CARD_ISSUER_CONFIG as unknown as Record<string, unknown>,
  );
  return merged as unknown as CardIssuerConfig;
}

// ── The checks themselves ────────────────────────────────────────────────────────────────────────

export function digitsOnly(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\D/g, '') : '';
}

/** Luhn: what catches a mistyped digit. */
export function luhnValid(number: string): boolean {
  if (!number) return false;
  let sum = 0;
  let alternate = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = number.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return false;
    if (alternate) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function prefixMatches(number: string, rule: string): boolean {
  const range = rule.split('-');
  if (range.length === 2) {
    const [low, high] = range;
    const head = number.slice(0, low.length);
    if (head.length < low.length) return false;
    const value = Number(head);
    return value >= Number(low) && value <= Number(high);
  }
  return number.startsWith(rule);
}

export function detectNetwork(number: string, networks: CardNetworkRule[]): CardNetworkRule | undefined {
  return networks.find((network) => network.prefixes.some((prefix) => prefixMatches(number, prefix)));
}

/** True when the expiry has passed. Unparseable input is a format error, not an expiry. */
export function isExpired(expiry: string, now = new Date()): boolean {
  const match = expiry.trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!match) return false;
  const month = Number(match[1]);
  if (month < 1 || month > 12) return false;
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  // A card is valid through the END of its expiry month.
  const endOfMonth = new Date(Date.UTC(year, month, 1));
  return now.getTime() >= endOfMonth.getTime();
}

export type CvvOutcome = 'match' | 'mismatch' | 'not_provided' | 'not_supported';

export interface CardValidationInput {
  cardNumber?: string;
  maskedPan?: string;
  network?: string;
  cvv?: string;
  expiry?: string;
  cardholderName?: string;
  cardToken?: string;
  // Derived by the caller, which needs the key vault, so these rules stay testable without key material.
  derivedCvv?: string;
  registeredHolderName?: string;
}

export interface CardValidationResult {
  valid: boolean;
  // ISO 8583: the card rail's vocabulary, which the PSP already speaks.
  responseCode: string;
  network?: string;
  cvvValidationResult: CvvOutcome;
  reasons: string[];
}

const RESPONSE_APPROVED = '00';
const RESPONSE_INVALID_CARD = '14';
const RESPONSE_EXPIRED_CARD = '54';
const RESPONSE_INVALID_CVV = '82';
const RESPONSE_INVALID_TRANSACTION = '12';

/** Validates a card against the live rules. The CVV is compared and discarded, never stored or returned. */
export function validateCard(input: CardValidationInput, config: CardIssuerConfig): CardValidationResult {
  const reasons: string[] = [];
  const pan = digitsOnly(input.cardNumber);
  const cvv = input.cvv === undefined || input.cvv === null ? '' : String(input.cvv);

  const enabledNetworks = config.networks.filter((network) => network.enabled);
  const network = pan ? detectNetwork(pan, enabledNetworks) : undefined;

  if (pan) {
    if (!network) reasons.push('unsupported_network');
    if (network && !network.lengths.includes(pan.length)) reasons.push('invalid_length');
    if (config.enforceLuhn && !luhnValid(pan)) reasons.push('failed_luhn');
  } else if (!input.cardToken) {
    // Neither a number nor a token, so there is nothing to validate.
    return { valid: false, responseCode: RESPONSE_INVALID_TRANSACTION, cvvValidationResult: 'not_provided', reasons: ['no_card_reference'] };
  }

  if (input.expiry && isExpired(input.expiry)) reasons.push('expired');

  if (config.verifyCardholderName && input.cardholderName && input.registeredHolderName) {
    if (input.cardholderName.trim().toLowerCase() !== input.registeredHolderName.trim().toLowerCase()) {
      reasons.push('cardholder_name_mismatch');
    }
  }

  // ── CVV ────────────────────────────────────────────────────────────────────────────────────────
  let cvvOutcome: CvvOutcome = 'not_provided';
  if (cvv) {
    const globalAccepted = (config.cvvMode === 'global' || config.cvvMode === 'both')
      && Boolean(config.validCvv) && cvv === config.validCvv;
    const perCardAccepted = (config.cvvMode === 'per_card' || config.cvvMode === 'both')
      && Boolean(input.derivedCvv) && cvv === input.derivedCvv;
    cvvOutcome = globalAccepted || perCardAccepted ? 'match' : 'mismatch';
    if (cvvOutcome === 'mismatch') reasons.push('cvv_mismatch');
  }

  if (reasons.includes('cvv_mismatch')) {
    return { valid: false, responseCode: RESPONSE_INVALID_CVV, network: network?.name, cvvValidationResult: cvvOutcome, reasons };
  }
  if (reasons.includes('expired')) {
    return { valid: false, responseCode: RESPONSE_EXPIRED_CARD, network: network?.name, cvvValidationResult: cvvOutcome, reasons };
  }
  if (reasons.length > 0) {
    return { valid: false, responseCode: RESPONSE_INVALID_CARD, network: network?.name, cvvValidationResult: cvvOutcome, reasons };
  }
  return { valid: true, responseCode: RESPONSE_APPROVED, network: network?.name, cvvValidationResult: cvvOutcome, reasons };
}

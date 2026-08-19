import { Db } from 'mongodb';
import { resolveModuleConfig } from '../../admin/services/bankModuleConfiguration.service';

// The issuer deciding whether a card is genuine: its format, its network, its expiry and its CVV.
//
// It lives at the bank because that is where the PAN lives, and because a card verification value is derived
// from issuer data (the PAN, the expiry, the service code and a card verification key). Nobody else can check
// it without holding what it is derived from.
//
// **Every rule here is configuration, not a constant.** The accepted CVV, the CVV mode, the Luhn requirement
// and the supported networks are read per call from the record the bank's admin API edits. That is the
// requirement this module exists to honour: an option that used to be settable on a PSP provider stays
// settable now that the engine moved.

export interface CardNetworkRule {
  name: string;
  // Exact leading digits ("4") or an inclusive range over them ("51-55", "2221-2720").
  prefixes: string[];
  lengths: number[];
  cvvLength: number;
  enabled: boolean;
}

/**
 * How a CVV may be accepted.
 *  - `global`   : only the configured escape-hatch value.
 *  - `per_card` : only the value derived for that card, which is the realistic behaviour.
 *  - `both`     : either, which is what keeps a demo workable while still exercising the derivation.
 */
export type CvvMode = 'both' | 'global' | 'per_card';

export interface CardIssuerConfig {
  // The global bypass code. **Configurable and never hardcoded**: it is edited at runtime through the
  // bank's admin API, and it is a demo value that is never a real card secret and is never stored.
  validCvv: string;
  cvvMode: CvvMode;
  enforceLuhn: boolean;
  verifyCardholderName: boolean;
  networks: CardNetworkRule[];
}

// Seed defaults only, NOT the acceptance rule. Every key here is overridden by the stored configuration,
// and they apply solely while a key has never been configured, so the engine always has a working rule set.
// Change the accepted CVV in the admin API, never in this constant.
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

/** Reads the live configuration. Per call, so an admin change takes effect without a restart. */
export async function cardIssuerConfig(db: Db): Promise<CardIssuerConfig> {
  // The resolver works over an index-signature record; the cast is at this ONE boundary rather than making
  // the config type indexable, which would let any string key look valid to a caller.
  const merged = await resolveModuleConfig(
    db, 'card-issuer', DEFAULT_CARD_ISSUER_CONFIG as unknown as Record<string, unknown>,
  );
  return merged as unknown as CardIssuerConfig;
}

// ── The checks themselves ────────────────────────────────────────────────────────────────────────

export function digitsOnly(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\D/g, '') : '';
}

/** Luhn (ISO/IEC 7812-1). A mistyped digit is the common case, and this is what catches it. */
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

/** True when the expiry has passed. Unparseable input is NOT treated as expired: it is a format error. */
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
  // Present for a card already registered here, which is what allows the per-card derivation.
  cardToken?: string;
  // The value the issuer derived for THIS card, computed by the caller because it needs the key vault.
  // Kept out of this function so the rules stay a pure decision, testable without any key material.
  derivedCvv?: string;
  registeredHolderName?: string;
}

export interface CardValidationResult {
  valid: boolean;
  // ISO 8583, because that is the card rail's vocabulary and the PSP already speaks it.
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

/**
 * Validates a card against the issuer's live rules.
 *
 * PCI DSS: the CVV is compared and discarded. It is never stored, never logged and never returned, and the
 * result says only whether it matched.
 */
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
    // Neither a number nor a registered token: there is nothing to validate.
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

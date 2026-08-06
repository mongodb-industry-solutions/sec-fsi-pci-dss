// Internal Card Issuer engine (built-in CVV/PIN + card-format validation; used when no external
// issuer vendor). It behaves as a configurable simulator: the validation rules (a fixed valid CVV,
// per-network number-format checks, and the set of supported card networks) are data-driven and
// stored in the capability module config, so new networks/rules can be added without code changes.
//
// PCI DSS Req 3.2: NO sensitive authentication data is stored. The CVV is only compared in memory
// against the configured value; neither the PAN nor the CVV is ever returned or logged.
import { CardIssuerInboundPayload } from '../../../modules/provider/models/externalProviderArrangement.model';

// ── Configurable rules ────────────────────────────────────────────────────────

export interface CardNetworkRule {
  /** Display name, e.g. "VISA". */
  name: string;
  /** Accepted IIN/BIN prefixes. Each entry is an exact start ("4", "34") or an inclusive numeric
   *  range over the leading digits ("51-55", "2221-2720"). */
  prefixes: string[];
  /** Accepted total card-number lengths (digits). */
  lengths: number[];
  /** Expected CVV length for this network (Visa/MC = 3, Amex = 4). */
  cvvLength: number;
  /** Disabled networks are treated as unsupported (declined) without removing the rule. */
  enabled: boolean;
}

/**
 * Which CVV values the engine accepts:
 *  - `both`     (default): the global escape-hatch CVV OR the realistic per-card derived CVV.
 *  - `global`   : only the fixed global CVV (fast demo, no per-card lookup).
 *  - `per_card` : only the derived per-card CVV (strict/realistic demo).
 */
export type CvvMode = 'both' | 'global' | 'per_card';

export interface CardIssuerSimulatorConfig {
  /**
   * The global CVV the simulator accepts (escape hatch). NOT hardcoded: it is part of the
   * card-issuer module configuration, edited at runtime by `operations_officer` or `manager`
   * (`modules:manage`) via PUT /config. A demo value, never a real card secret and never stored.
   */
  validCvv: string;
  /** CVV acceptance mode (see CvvMode). Defaults to `both` so existing v29 demos keep working. */
  cvvMode: CvvMode;
  /** When true, full card numbers must pass the Luhn checksum. */
  enforceLuhn: boolean;
  /**
   * When true, an interactive payment that supplies a cardholder name has it verified against the
   * registered owner (resolved via the Card Reference -> party port). Skipped on the tokenized
   * card-on-file path (no name is sent). Default false so existing v29 demos keep working.
   */
  verifyCardholderName: boolean;
  /** Supported card networks. Extend this list to add a new network. */
  networks: CardNetworkRule[];
}

// Seed defaults only, NOT the acceptance rule: every key here is overridden by the stored
// card-issuer module configuration, which `operations_officer` (or `manager`) edits at runtime with
// `modules:manage`. They apply while a key has never been configured, so the module always has a
// working rule set. Change the accepted CVV in the module admin, never in this constant.
export const DEFAULT_CARD_ISSUER_CONFIG: CardIssuerSimulatorConfig = {
  validCvv: '123',
  cvvMode: 'both',
  enforceLuhn: true,
  verifyCardholderName: false,
  networks: [
    { name: 'VISA',       prefixes: ['4'],                     lengths: [13, 16, 19], cvvLength: 3, enabled: true },
    { name: 'MASTERCARD', prefixes: ['51-55', '2221-2720'],    lengths: [16],         cvvLength: 3, enabled: true },
    { name: 'AMEX',       prefixes: ['34', '37'],              lengths: [15],         cvvLength: 4, enabled: true },
    { name: 'DISCOVER',   prefixes: ['6011', '644-649', '65'], lengths: [16, 19],     cvvLength: 3, enabled: true },
  ],
};

// Merge stored overrides over the defaults. `networks`, when provided, replaces the default list
// wholesale (so an operator can curate the exact supported set).
export function resolveCardIssuerConfig(moduleConfig: Record<string, unknown> | undefined | null): CardIssuerSimulatorConfig {
  const c = (moduleConfig ?? {}) as Partial<CardIssuerSimulatorConfig>;
  const cvvMode: CvvMode = c.cvvMode === 'global' || c.cvvMode === 'per_card' || c.cvvMode === 'both'
    ? c.cvvMode : DEFAULT_CARD_ISSUER_CONFIG.cvvMode;
  return {
    validCvv: typeof c.validCvv === 'string' && c.validCvv.length ? c.validCvv : DEFAULT_CARD_ISSUER_CONFIG.validCvv,
    cvvMode,
    enforceLuhn: typeof c.enforceLuhn === 'boolean' ? c.enforceLuhn : DEFAULT_CARD_ISSUER_CONFIG.enforceLuhn,
    verifyCardholderName: typeof c.verifyCardholderName === 'boolean' ? c.verifyCardholderName : DEFAULT_CARD_ISSUER_CONFIG.verifyCardholderName,
    networks: Array.isArray(c.networks) && c.networks.length ? c.networks : DEFAULT_CARD_ISSUER_CONFIG.networks,
  };
}

// ── Validation primitives ───────────────────────────────────────────────────

function digitsOnly(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\D/g, '') : '';
}

function luhnValid(num: string): boolean {
  if (!num) return false;
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Does the card number start with this prefix rule? Rule is an exact start ("4") or an inclusive
// numeric range over the leading digits ("51-55", "2221-2720").
function prefixMatches(num: string, rule: string): boolean {
  const range = rule.split('-');
  if (range.length === 2) {
    const [lo, hi] = range;
    const width = lo.length;
    const head = num.slice(0, width);
    if (head.length < width) return false;
    const n = Number(head);
    return n >= Number(lo) && n <= Number(hi);
  }
  return num.startsWith(rule);
}

function detectNetwork(num: string, networks: CardNetworkRule[]): CardNetworkRule | undefined {
  return networks.find((nw) => nw.prefixes.some((p) => prefixMatches(num, p)));
}

function networkByName(name: string, networks: CardNetworkRule[]): CardNetworkRule | undefined {
  const n = name.trim().toUpperCase();
  return networks.find((nw) => nw.name.toUpperCase() === n);
}

// True when the expiry (MM/YY or MM/YYYY) is in the past (the card is expired at end of that month).
// Returns false for unparseable input so malformed values are not treated as expired.
function isExpired(expiry: string): boolean {
  const m = expiry.trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m) return false;
  const month = parseInt(m[1], 10);
  if (month < 1 || month > 12) return false;
  const year = m[2].length === 2 ? 2000 + parseInt(m[2], 10) : parseInt(m[2], 10);
  const now = new Date();
  // Card is valid through the LAST day of the expiry month; expired once the next month starts.
  const firstOfNextMonth = new Date(year, month, 1);
  return firstOfNextMonth <= now;
}

// ── Validation result ──────────────────────────────────────────────────────

export interface CardValidationResult {
  approved: boolean;
  /** ISO-8583-style response code: 00 approved, 14 invalid number, 82 invalid CVV, 12 unsupported. */
  responseCode: string;
  network: string | null;
  cvvValidationResult: 'match' | 'no_match' | 'not_provided';
  decisionReason: string;
  /** Last 4 digits only, for safe display/logging. Never the full PAN. */
  last4: string | null;
}

// Reads the (possibly tokenized) request and applies the configured rules. When a full card number
// is present (direct simulator test) it runs network detection, Luhn and length checks; when only a
// masked PAN + network are present (the tokenized payment path) it validates the network is
// supported and the CVV when supplied. The PAN/CVV are used only transiently and never persisted.
export interface CardValidationOptions {
  /** Realistic per-card CVV derived from the CVK (HMAC). Compared when cvvMode allows per-card. */
  perCardCvv?: string;
  /** True when the card is registered (card-on-file exists and is active). */
  cardRegistered?: boolean;
  /** True when the card has a known funding/payout account linked. */
  hasFundingAccount?: boolean;
  /** Registered owner (cardholder) name, resolved via the port; compared when verifyCardholderName is on. */
  expectedCardholderName?: string;
}

// Normalize a name for a lenient comparison: trim, lower-case, collapse internal whitespace, drop
// punctuation. Names are compared, never logged or stored.
function normalizeName(v: unknown): string {
  return typeof v === 'string'
    ? v.normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()
    : '';
}

// Accept the supplied CVV against the configured mode: the global escape-hatch value and/or the
// realistic per-card derived value. The length check (when the network is known) still applies.
function cvvAccepted(cvv: string, config: CardIssuerSimulatorConfig, perCardCvv: string | undefined): boolean {
  const globalOk = (config.cvvMode === 'global' || config.cvvMode === 'both') && cvv === config.validCvv;
  const perCardOk = (config.cvvMode === 'per_card' || config.cvvMode === 'both')
    && !!perCardCvv && cvv === perCardCvv;
  return globalOk || perCardOk;
}

export function validateCard(
  input: Record<string, unknown>,
  config: CardIssuerSimulatorConfig,
  opts: CardValidationOptions = {},
): CardValidationResult {
  const fullPan = digitsOnly(input.cardNumber ?? input.pan ?? input.primaryAccountNumber ?? input.fullCardNumber);
  const maskedPan = typeof input.maskedPan === 'string' ? input.maskedPan
    : typeof input.cardTransactionMaskedPanDisplay === 'string' ? input.cardTransactionMaskedPanDisplay : '';
  const cvvRaw = input.cvv ?? input.cvv2 ?? input.cvc ?? input.cvc2;
  const cvv = cvvRaw === undefined || cvvRaw === null ? '' : String(cvvRaw);
  const networkHint = typeof input.network === 'string' ? input.network
    : typeof input.cardNetwork === 'string' ? input.cardNetwork : '';
  const expiryRaw = input.expiry ?? input.cardExpiry ?? input.expiryDate;
  const expiry = typeof expiryRaw === 'string' ? expiryRaw : '';

  const last4 = (fullPan || maskedPan).replace(/\D/g, '').slice(-4) || null;

  // The network is only ASSESSABLE when we have a full PAN (we can read the BIN) or an explicit
  // network hint. In a tokenized payment that carries neither, the network was already validated at
  // card-entry time, so we must NOT re-decline it here, that would wrongly reject legitimate cards.
  const assessable = !!fullPan || !!networkHint;
  const rule = fullPan ? detectNetwork(fullPan, config.networks) : (networkHint ? networkByName(networkHint, config.networks) : undefined);
  const network = rule?.name ?? (networkHint || null);

  if (assessable && (!rule || !rule.enabled)) {
    return { approved: false, responseCode: '12', network, cvvValidationResult: 'not_provided', decisionReason: 'unsupported_or_disabled_network', last4 };
  }

  // Expiry check (when supplied): an expired card is declined (ISO-8583 response code 54). A
  // malformed value is ignored rather than declined, to stay lenient on input formatting.
  if (expiry && isExpired(expiry)) {
    return { approved: false, responseCode: '54', network, cvvValidationResult: 'not_provided', decisionReason: 'expired_card', last4 };
  }

  // Full-PAN checks (only possible when the PAN is present; the tokenized path has a masked PAN only).
  if (fullPan) {
    if (config.enforceLuhn && !luhnValid(fullPan)) {
      return { approved: false, responseCode: '14', network, cvvValidationResult: 'not_provided', decisionReason: 'failed_luhn_check', last4 };
    }
    if (rule && !rule.lengths.includes(fullPan.length)) {
      return { approved: false, responseCode: '14', network, cvvValidationResult: 'not_provided', decisionReason: 'invalid_length_for_network', last4 };
    }
  }

  // D1 (P13.1): on a CVV-bearing channel (interactive checkout / payment-link / simulator), the PSP
  // sets `cvvExpected`. A missing CVV there is a decline (82): the card-present-style verification
  // was required but absent. Card-on-file / recurring tokenized payments do not set the flag, so they
  // keep approving without a CVV.
  const cvvExpected = input.cvvExpected === true || input.cvvExpected === 'true';
  if (cvvExpected && !cvv) {
    return { approved: false, responseCode: '82', network, cvvValidationResult: 'not_provided', decisionReason: 'cvv_required', last4 };
  }

  // Registration + funding-account checks (v30): a card the PSP does not know, or one without a
  // known funding/payout account, is declined. These facts are resolved by the caller via the Card
  // Reference / Funding Account ports; they are only enforced when the caller asserts them (the
  // direct simulator test path leaves them undefined and stays lenient).
  if (opts.cardRegistered === false) {
    return { approved: false, responseCode: '56', network, cvvValidationResult: 'not_provided', decisionReason: 'card_not_registered', last4 };
  }
  if (opts.hasFundingAccount === false) {
    return { approved: false, responseCode: '57', network, cvvValidationResult: 'not_provided', decisionReason: 'no_funding_account', last4 };
  }

  // Cardholder-name verification (v30.1): only when a name is supplied (interactive PAN-entry path).
  // The tokenized card-on-file path sends no name, so this is skipped (opts.expectedCardholderName
  // may still be set, but suppliedName is empty -> skip). Never logs the names.
  const suppliedName = input.cardHolderName ?? input.cardholderName ?? input.nameOnCard ?? input.name;
  // Honor the module flag directly (single source of truth): only compare when verifyCardholderName is
  // enabled, so the check can never fire when the feature is off even if a caller supplies an expected name.
  if (config.verifyCardholderName && normalizeName(suppliedName) && opts.expectedCardholderName !== undefined) {
    if (normalizeName(suppliedName) !== normalizeName(opts.expectedCardholderName)) {
      return { approved: false, responseCode: '05', network, cvvValidationResult: 'not_provided', decisionReason: 'cardholder_name_mismatch', last4 };
    }
  }

  // CVV check (only when a CVV is supplied; the tokenized path does not send one). Accept the global
  // escape-hatch value and/or the realistic per-card derived value per cvvMode. The length is only
  // enforced when we know the network (and therefore its expected CVV length).
  let cvvValidationResult: CardValidationResult['cvvValidationResult'] = 'not_provided';
  if (cvv) {
    const lengthOk = rule ? cvv.length === rule.cvvLength : true;
    const ok = cvvAccepted(cvv, config, opts.perCardCvv) && lengthOk;
    cvvValidationResult = ok ? 'match' : 'no_match';
    if (!ok) {
      return { approved: false, responseCode: '82', network, cvvValidationResult, decisionReason: 'invalid_cvv', last4 };
    }
  }

  return { approved: true, responseCode: '00', network, cvvValidationResult, decisionReason: 'approved', last4 };
}

// Issuer inbound payload shape, enriched with the validation outcome (responseCode /
// cvvValidationResult / network) used by the callback flow.
export type CardIssuerValidationResponse = CardIssuerInboundPayload & {
  responseCode: string;
  cvvValidationResult: string;
  network: string | null;
  decisionReason: string;
};

export function validateCardIssuer(
  input: Record<string, unknown>,
  config: CardIssuerSimulatorConfig = DEFAULT_CARD_ISSUER_CONFIG,
  opts: CardValidationOptions = {},
): CardIssuerValidationResponse {
  const r = validateCard(input, config, opts);
  return {
    cardStatus: 'active',
    actionConfirmed: r.approved,
    responseCode: r.responseCode,
    cvvValidationResult: r.cvvValidationResult,
    network: r.network,
    decisionReason: r.decisionReason,
  };
}

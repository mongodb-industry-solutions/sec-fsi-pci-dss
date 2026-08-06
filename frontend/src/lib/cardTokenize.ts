// Client-side card tokenization (PCI DSS demo model).
//
// In this system the browser is the tokenization boundary: the full PAN and the CVV are
// validated here and NEVER leave the browser. Only the derived masked PAN and a surrogate token
// are sent to the server. The CVV (sensitive authentication data, SAD) is used for validation
// and then discarded; it is never transmitted or stored at any layer (PCI DSS).

export type CardNetwork = 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';

// Detect the card network from the PAN prefix (simplified ranges sufficient for the demo).
export function detectNetwork(panDigits: string): CardNetwork | null {
  if (/^4/.test(panDigits)) return 'VISA';
  if (/^3[47]/.test(panDigits)) return 'AMEX';
  // ELO sample BIN ranges (must be checked before generic Mastercard 51-55 / 2-series).
  if (/^(4011|4312|4389|5041|5066|5090|6277|6362|6363|650|651|655)/.test(panDigits)) return 'ELO';
  if (/^(5[1-5]|2[2-7])/.test(panDigits)) return 'MASTERCARD';
  return null;
}

// Luhn checksum; rejects typos and obviously invalid numbers.
export function luhnValid(panDigits: string): boolean {
  if (!/^\d{12,19}$/.test(panDigits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = panDigits.length - 1; i >= 0; i--) {
    let d = panDigits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// Expiry must be MM/YY and not in the past (relative to the given "now").
export function expiryValid(mmYY: string, now = new Date()): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(mmYY.trim());
  if (!m) return false;
  const month = parseInt(m[1], 10);
  const year = 2000 + parseInt(m[2], 10);
  if (month < 1 || month > 12) return false;
  // Card is valid through the end of its expiry month.
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);
  return endOfMonth.getTime() >= now.getTime();
}

// CVV length depends on the network: AMEX = 4 digits, everyone else = 3.
export function cvvValid(cvv: string, network: CardNetwork | null): boolean {
  const len = network === 'AMEX' ? 4 : 3;
  return new RegExp(`^\\d{${len}}$`).test(cvv.trim());
}

export interface TokenizeInput { pan: string; expiry: string; cvv: string }
export interface TokenizeResult { token: string; maskedPan: string; network: CardNetwork; expiry: string }

// Demo tokenization key. In production the token comes from a PCI-compliant tokenization vault/HSM;
// here we derive it deterministically with a keyed HMAC so the SAME card number always yields the
// SAME token. PCI DSS: the token must not be reversible to the PAN; a *keyed* HMAC (not a bare hash
// of the low-entropy PAN) is the accepted construction. NOTE: a browser cannot truly hold a secret,
// so this key is a stand-in; a real deployment performs this server-side / in the vault.
const TOKEN_KEY = process.env.NEXT_PUBLIC_CARD_TOKEN_KEY || 'demo-psp-tokenization-key-v1';

// Deterministic surrogate token: HMAC-SHA256(PAN) keyed with TOKEN_KEY → `pm_<24 hex><last4>`.
// Same PAN → same token, so a card is never duplicated in the registry / a customer's wallet.
export async function deriveCardToken(panDigits: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(TOKEN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(panDigits));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < 12; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return `pm_${hex}${panDigits.slice(-4)}`;
}

// Validate the raw card details and return only non-sensitive, storable artifacts.
// Throws Error(<friendly message>) on the first validation failure. The CVV is consumed here
// and never included in the result. Async because the token is derived via Web Crypto HMAC.
export async function tokenizeCard({ pan, expiry, cvv }: TokenizeInput): Promise<TokenizeResult> {
  const digits = pan.replace(/\D/g, '');
  const network = detectNetwork(digits);
  if (!network) throw new Error('Unrecognized card network. Check the card number.');
  if (!luhnValid(digits)) throw new Error('That card number looks invalid.');
  if (!expiryValid(expiry)) throw new Error('Enter a valid, non-expired date as MM/YY.');
  if (!cvvValid(cvv, network)) throw new Error(`Enter a valid ${network === 'AMEX' ? '4' : '3'}-digit security code.`);

  const last4 = digits.slice(-4);
  const token = await deriveCardToken(digits);
  return {
    token,
    maskedPan: `****-****-****-${last4}`,
    network,
    expiry: expiry.trim(),
    // cvv intentionally NOT returned; discarded after validation (PCI DSS: SAD never stored).
  };
}

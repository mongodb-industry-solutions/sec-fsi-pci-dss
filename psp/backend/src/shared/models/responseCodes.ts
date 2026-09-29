// ISO-8583-style response codes used on the card_payment bus gates (§7). Shared so gate reactors
// and the saga agree on a single vocabulary. Distinct from the stub's 4-digit provider codes
// in cardAuthorization.service.ts (that is an issuer-adapter internal detail, not a bus contract).

export const RESPONSE_CODE_APPROVED = '00';
export const RESPONSE_CODE_DECLINED = '05';
export const RESPONSE_CODE_INSUFFICIENT_FUNDS = '51';
/**
 * The issuer could not be reached, or answered without a verdict.
 *
 * `91` is the card rail's own code for an unavailable issuer, so a caller that speaks the rail already knows
 * what it means. It exists because the issuer is now another institution across a network: "cannot ask" is an
 * ordinary outcome, and it is NOT the same as "asked and was declined". Conflating the two would hide an
 * integration failure inside a wall of ordinary declines.
 */
export const RESPONSE_CODE_ISSUER_UNAVAILABLE = '91';

/** Human-readable decision reasons carried alongside a decline responseCode. */
export const DECISION_REASON_INSUFFICIENT_FUNDS = 'insufficient_funds';
export const DECISION_REASON_ACCOUNT_NOT_FOUND = 'account_not_found';

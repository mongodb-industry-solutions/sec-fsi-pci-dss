// BIAN SD-64: Payment Order - Checkout Session Control Record
// Represents a Redirect Checkout session: merchant creates it, buyer pays on the HPP.

export const CHECKOUT_SESSION_COLLECTION = 'checkoutSessionLog';

export type CheckoutSessionStatus = 'pending' | 'completed' | 'expired' | 'cancelled';

export interface CheckoutSessionRecord {
  // BIAN metadata
  bianServiceDomain: 'Payment Order';
  bianControlRecordType: 'CheckoutSessionLog';
  schemaVersion: 1;

  // Primary key
  checkoutSessionInstanceReference: string;      // UUID

  // Merchant
  merchantAgreementInstanceReference: string;    // FK to merchantAgreementProcedure
  merchantName: string;                          // Denormalized for HPP display

  // Payment details
  checkoutSessionAmount: number;
  checkoutSessionCurrency: string;               // ISO 4217
  checkoutSessionDescription: string;

  // Lifecycle
  checkoutSessionStatus: CheckoutSessionStatus;

  // Redirect URLs
  checkoutSessionReturnUrl: string;
  checkoutSessionCancelUrl: string;

  // Idempotency
  checkoutSessionMerchantReference: string;      // Merchant's own order/cart ID

  // v18 attribution (on-behalf-of): when the merchant app created this session while acting for a
  // logged-in user, we capture WHO so the resulting card transaction lands under the payer and the
  // purchase is auditable. These are identity references only, never CHD/PAN, never PII beyond the id.
  checkoutSessionActingSubjectReference?: string; // SD-91 OAuth subject (customerAuthenticationInstanceReference)
  checkoutSessionActingPartyReference?: string;   // SD-13 partyInstanceReference (resolved from the subject)
  checkoutSessionActingClientId?: string;         // OAuth client_id of the acting merchant app

  // Timing
  checkoutSessionCreatedDateTime: Date;
  checkoutSessionExpiresAt: Date;                // TTL index target (default: +30 min)
  checkoutSessionCompletedDateTime?: Date;

  // Result
  cardTransactionInstanceReference?: string;     // FK - set on successful payment

  // BIAN standard fields
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}

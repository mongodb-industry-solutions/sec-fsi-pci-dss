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

// Payment Order - Payment Link Control Record
// Represents a shareable payment URL: merchant creates once, buyer pays anytime.

export const PAYMENT_LINK_COLLECTION = 'paymentLinkRecord';

export type PaymentLinkStatus = 'active' | 'completed' | 'expired' | 'deactivated';
export type PaymentLinkUsageType = 'single_use' | 'multi_use';

export interface PaymentLinkRecord {
  // BIAN metadata
  bianServiceDomain: 'Payment Order';
  bianControlRecordType: 'PaymentLinkRecord';
  schemaVersion: 1;

  // Primary keys
  paymentLinkInstanceReference: string;          // UUID (API management key)
  paymentLinkCode: string;                       // 8-char URL-safe code: /pay/{code}

  // Merchant
  merchantAgreementInstanceReference: string;    // FK to merchantAgreementProcedure
  merchantName: string;                          // Denormalized for payment page display

  // Payment details
  paymentLinkAmount: number;
  paymentLinkCurrency: string;                   // ISO 4217
  paymentLinkDescription: string;
  paymentLinkCustomerMessage?: string;           // Optional message shown on payment page

  // Configuration
  paymentLinkStatus: PaymentLinkStatus;
  paymentLinkUsageType: PaymentLinkUsageType;
  paymentLinkCurrentUses: number;
  paymentLinkMaxUses?: number;                   // Enforced for multi_use limits

  // Timing
  paymentLinkCreatedDateTime: Date;
  paymentLinkExpiresAt?: Date;                   // Optional TTL (sparse index)

  // Results
  paymentLinkTransactionReferences: string[];    // FK array of cardTransactionInstanceReference

  // BIAN standard fields
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}

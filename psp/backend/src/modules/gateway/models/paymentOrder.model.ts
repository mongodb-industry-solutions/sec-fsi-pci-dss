// Payment Order Control Record
// Payment Execution is represented as the routingDecision sub-document

export const PAYMENT_ORDER_COLLECTION = 'paymentOrderProcedure';

export interface PaymentOrderControlRecord {
  // Identifiers
  paymentOrderInstanceReference: string;            // UUID, primary key
  paymentOrderReference: string;                    // Human-readable: PO-2026-001234
  idempotencyKey: string;                           // Unique per merchant; replay protection

  // Links
  merchantAgreementInstanceReference: string;       // FK → merchantAgreement (plaintext)
  customerAgreementInstanceReference?: string;      // FK → customerAgreement (populated on confirm)
  linkedCardTransactionReference?: string;          // FK → cardTransaction (populated on authorize)

  // v17: Payout orchestration fields 
  paymentOrderBeneficiaryType?: BeneficiaryType;    // 'merchant' | 'user' | 'anonymous'
  paymentOrderBeneficiaryReference?: string;        // partyRef for user payouts / anonymous target
  paymentOrderCaptureStrategy: CaptureStrategy;     // default 'immediate'
  paymentOrderExecutionReference?: string;          // FK → paymentExecutionProcedure 

  // Payment details
  paymentOrderAmount: { amount: number; currency: string };
  paymentOrderMerchantReference: string;            // Merchant's own order ID
  paymentOrderDescription?: string;

  // Lifecycle  -  Payment Order state machine
  paymentOrderStatus: PaymentOrderStatus;
  paymentOrderInitiatedDateTime: Date;
  paymentOrderConfirmedDateTime?: Date;
  paymentOrderAuthorizedDateTime?: Date;
  paymentOrderCapturedDateTime?: Date;
  paymentOrderSettledDateTime?: Date;
  paymentOrderVoidedDateTime?: Date;
  paymentOrderRefundedDateTime?: Date;
  paymentOrderExpiresAt: Date;                      // TTL: auto-expire stale initiated orders

  // Routing  -  Payment Execution decision
  routingDecision?: {
    processor: string;                              // e.g. 'simulated_processor_v1'
    routedAt: Date;
    routingReason: string;
  };

  // Refund record (populated if refunded)
  refundRecord?: {
    refundAmount: number;
    refundDateTime: Date;
    refundReason: string;
  };

  // Webhook delivery
  webhookDeliveryRecord?: {
    url: string;
    deliveredAt?: Date;
    attempts: number;
    lastHttpStatus?: number;
  };

  // BIAN metadata
  bianServiceDomain: 'Payment Order';
  bianControlRecordType: 'PaymentOrderProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

export type BeneficiaryType = 'merchant' | 'user' | 'anonymous';
export type CaptureStrategy = 'immediate' | 'manual';

export type PaymentOrderStatus =
  | 'initiated'
  | 'confirmed'
  | 'authorized'
  | 'captured'
  | 'settled'
  | 'voided'
  | 'refunded'
  | 'failed'
  | 'expired';

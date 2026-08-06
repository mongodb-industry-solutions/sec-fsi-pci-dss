// BIAN SD-88: Payment Card, the physical card INSTRUMENT, registered ONCE per card.
//
// Rationale (ADR-027, FDS/AML): a single card (same PAN → same deterministic token) may be held by
// several customers. The per-customer relationship lives in `paymentCardManagement` (the card-on-file
// arrangement, one row per customer-card). This registry deduplicates the card itself to a single
// document keyed by the surrogate token, so the system knows each physical card once and can report
// HOW MANY customers use it: a strong shared-card / money-mule signal for FDS/AML.
//
// PCI DSS: stores only NON-CHD identity fields, the surrogate token (not CHD), the display-safe
// masked PAN, and the network. No expiry (QE) and no CVV ever. It is a plaintext collection.

export const PAYMENT_CARD_REGISTRY_COLLECTION = 'paymentCardRegistry';

export interface PaymentCardRegistryRecord {
  paymentCardRegistryInstanceReference: string;
  // The deterministic surrogate token: UNIQUE. Same physical PAN always maps here.
  paymentCardReference: string;
  paymentCardMaskedPanDisplay: string;
  paymentCardNetwork?: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
  // Current (non-revoked) holders of this card. Distinct customer agreement references.
  cardHolderAgreementReferences: string[];
  // = cardHolderAgreementReferences.length. Maintained on every register/revoke. FDS/AML signal.
  cardHolderCount: number;
  firstRegisteredDateTime: Date;
  recordUpdatedDateTime: Date;
  bianServiceDomain: 'Payment Card';
  bianControlRecordType: 'PaymentCardRegistry';
  schemaVersion: number;
}

// Above this many distinct holders, a shared card is flagged for FDS/AML review (compliance event).
export const SHARED_CARD_HOLDER_THRESHOLD = 3;

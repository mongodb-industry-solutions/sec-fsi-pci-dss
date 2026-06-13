// BIAN SD-88: Payment Card
// CR: PaymentCardManagement

export const PAYMENT_CARD_COLLECTION = 'paymentCardManagement';

export interface PaymentCardManagementControlRecord {
  paymentCardInstanceReference: string;
  customerAgreementInstanceReference: string;
  // Plaintext: token is a card surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;
  // QE none: non-searchable, retrieval only. Optional: a card auto-registered from an external
  // payment may not carry the expiry; the customer can add it later. Never holds a CVV.
  paymentCardExpirationDate?: string;
  paymentCardMaskedPanDisplay: string;
  // Optional: not every payment source reports the scheme (e.g. token-only external integrations).
  paymentCardNetwork?: CardNetwork;
  paymentCardStatus: CardStatus;
  paymentCardIssuanceDateTime: Date;
  paymentCardIsPreferred: boolean;
  // Customer-defined, NON-CHD descriptive metadata (the only customer-editable attributes).
  // PCI DSS: these are free-text display labels only — they MUST NOT contain a PAN/CVV; the UI
  // and API treat them as a nickname/memo so the cardholder can recognize a card-on-file.
  // BIAN SD-88: customer-facing presentation attributes of the PaymentCardManagement control record.
  paymentCardAlias?: string;
  paymentCardCustomerNote?: string;
  // v4: recurring payment mandate
  paymentCardMandateStatus?: 'active' | 'cancelled' | 'expired';
  paymentCardConsentDateTime?: Date;
  paymentCardMandateExpiryDate?: Date;
  bianServiceDomain: 'Payment Card';
  bianControlRecordType: 'PaymentCardManagement';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime?: Date;
  schemaVersion: number;
}

export type CardNetwork = 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
export type CardStatus =
  | 'issued'
  | 'active'
  | 'pending_activation'
  | 'blocked'
  | 'suspended'
  | 'revoked'
  | 'expired';

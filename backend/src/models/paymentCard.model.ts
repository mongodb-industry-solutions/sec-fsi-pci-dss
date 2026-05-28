// BIAN SD-88: Payment Card

export const PAYMENT_CARD_COLLECTION = 'paymentCard';

export interface PaymentCardManagementControlRecord {
  paymentCardInstanceReference: string;
  customerAgreementInstanceReference: string;
  // Plaintext: token is a card surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;
  // QE none: non-searchable, retrieval only
  paymentCardExpirationDate: string;
  paymentCardMaskedPanDisplay: string;
  paymentCardNetwork: CardNetwork;
  paymentCardStatus: CardStatus;
  paymentCardIssuanceDateTime: Date;
  paymentCardIsPreferred: boolean;
  // v4: recurring payment mandate
  paymentCardMandateStatus?: 'active' | 'cancelled' | 'expired';
  paymentCardConsentDateTime?: Date;
  paymentCardMandateExpiryDate?: Date;
  bianServiceDomain: 'PaymentCard';
  bianControlRecordType: 'PaymentCardManagement';
  recordCreatedDateTime: Date;
}

export type CardNetwork = 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
export type CardStatus =
  | 'active'
  | 'blocked'
  | 'expired'
  | 'pending_activation';

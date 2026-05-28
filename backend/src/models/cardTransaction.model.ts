// BIAN SD-254: Card Transaction

export const CARD_TRANSACTION_COLLECTION = 'cardTransaction';
export const CARD_TRANSACTION_SENSITIVE_COLLECTION = 'cardTransactionSensitive';

export interface CardTransactionLogControlRecord {
  cardTransactionInstanceReference: string;
  cardTransactionExternalReference?: string;
  // Plaintext: token is a card surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;
  // QE equality: searchable encrypted field
  cardTransactionAccountReference: string;
  cardTransactionAmount: {
    amount: number;
    currency: string;
  };
  cardTransactionDateTime: Date;
  cardTransactionStatus: CardTransactionStatus;
  cardTransactionChannel: CardTransactionChannel;
  cardTransactionInitiationType: CardTransactionInitiationType;
  cardTransactionMerchantCategoryCode: string;
  cardTransactionMerchantName: string;
  cardTransactionMaskedPanDisplay: string;
  bianServiceDomain: 'CardTransaction';
  bianControlRecordType: 'CardTransactionLog';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}

export interface CardTransactionSensitiveRecord {
  cardTransactionInstanceReference: string;
  rawGatewayPayload: object;
  processorTransactionMetadata: object;
}

export type CardTransactionStatus =
  | 'authorized'
  | 'declined'
  | 'pending'
  | 'settled'
  | 'disputed';

export type CardTransactionChannel = 'online' | 'pos' | 'contactless' | 'atm';

export type CardTransactionInitiationType =
  | 'customerInitiated'
  | 'merchantInitiated';

// BIAN SD-254: Card Transaction

export const CARD_TRANSACTION_COLLECTION = 'cardTransactionQE';
export const CARD_TRANSACTION_SENSITIVE_COLLECTION = 'cardTransactionSensitiveQE';

export interface CardTransactionLogControlRecord {
  cardTransactionInstanceReference: string;
  cardTransactionExternalReference?: string;
  // Plaintext: token is a card surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;
  // QE equality: searchable encrypted field
  cardTransactionAccountReference: string;
  transactionAmount: {
    amount: number;
    currency: string;
  };
  transactionDateTime: Date;
  transactionStatus: CardTransactionStatus;
  transactionChannel: CardTransactionChannel;
  cardTransactionInitiationType: CardTransactionInitiationType;
  merchantCategoryCode: string;
  merchantName: string;
  maskedPanDisplay: string;
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

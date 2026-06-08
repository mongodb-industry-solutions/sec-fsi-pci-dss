// BIAN SD-254: Card Transaction
// CR: CardTransactionLog
//
// v2: rawGatewayPayload and processorTransactionMetadata are merged into this single
// collection as QE:none fields (DEK-sensitive tier). Level 1 QE client omits these
// from its encryptedFieldsMap → returned as Binary ciphertext, stripped from response.
// Level 2 QE client includes them → auto-decrypted by the driver. See roleClients.ts.

export const CARD_TRANSACTION_COLLECTION = 'cardTransactionLog';

export interface CardTransactionLogControlRecord {
  cardTransactionInstanceReference: string;
  cardTransactionExternalReference?: string;

  // Plaintext: token is a card surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;

  // QE:equality (DEK-lookup tier) — searchable, Level 1+
  cardTransactionAccountReference: string;

  // QE:none (DEK-sensitive tier) — non-searchable, Level 2+ only
  // Present as decrypted value with L2 QE client; Binary ciphertext with L1 client.
  rawGatewayPayload?: object;
  processorTransactionMetadata?: object;

  // Plaintext transaction metadata
  cardTransactionAmount: { amount: number; currency: string };
  cardTransactionDateTime: Date;
  cardTransactionStatus: CardTransactionStatus;
  cardTransactionChannel: CardTransactionChannel;
  cardTransactionInitiationType: CardTransactionInitiationType;
  cardTransactionMerchantCategoryCode: string;
  cardTransactionMerchantName: string;
  cardTransactionMaskedPanDisplay: string;

  bianServiceDomain: 'Card Transaction';
  bianControlRecordType: 'CardTransactionLog';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
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

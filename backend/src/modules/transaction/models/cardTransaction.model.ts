// BIAN SD-254: Card Transaction
// CR: CardTransactionLog
//
// v2: rawGatewayPayload and processorTransactionMetadata are merged into this single
// collection as QE:none fields (DEK-sensitive tier). Level 1 QE client omits these
// from its encryptedFieldsMap → returned as Binary ciphertext, stripped from response.
// Level 2 QE client includes them → auto-decrypted by the driver. See roleClients.ts.

import type { PaymentExecutionFee } from '../../gateway/models/paymentExecution.model';

export const CARD_TRANSACTION_COLLECTION = 'cardTransactionLog';

export interface CardTransactionLogControlRecord {
  cardTransactionInstanceReference: string;
  cardTransactionExternalReference?: string;

  // Plaintext: token is a card surrogate, not CHD under PCI DSS v4.0
  paymentCardReference: string;

  // QE:equality (DEK-lookup tier) - searchable, Level 1+
  cardTransactionAccountReference: string;

  // QE:none (DEK-sensitive tier) - non-searchable, Level 2+ only
  // Present as decrypted value with L2 QE client; Binary ciphertext with L1 client.
  rawGatewayPayload?: object;
  processorTransactionMetadata?: object;

  // Plaintext transaction metadata
  cardTransactionAmount: { amount: number; currency: string };
  cardTransactionDateTime: Date;
  cardTransactionStatus: CardTransactionStatus;
  cardTransactionType: CardTransactionType;
  cardTransactionChannel: CardTransactionChannel;
  cardTransactionInitiationType: CardTransactionInitiationType;
  cardTransactionMerchantCategoryCode: string;
  cardTransactionMerchantName: string;
  cardTransactionMaskedPanDisplay: string;

  // Acquiring-side link (BIAN SD-89 Merchant Relations): the merchant the payment
  // was made TO. Plaintext + indexed — a merchant identifier, not CHD/PII — so the
  // merchant owner can list their received payments. Optional: legacy/direct
  // transactions created without a merchant context omit it.
  merchantAgreementInstanceReference?: string;

  // v17: FK → paymentExecutionProcedure (SD-65) — set when payout orchestration creates the execution
  paymentExecutionInstanceReference?: string;

  // v18 (SD-254 acquiring / SD-89 pricing): merchant-commission captured on an ACQUIRING card payment.
  // The numeric amount lives in the flat `feeAmount`; the `fee` sub-doc records WHO the commission is
  // attributed to and HOW it was derived, so the merchant dashboard aggregates commission revenue
  // (SD-89) from this acquiring record at runtime. Not CHD (just amounts) → NOT QE-encrypted.
  // Set once at authorization for merchant-attributed payments (idempotent); absent otherwise.
  feeAmount?: number;
  fee?: PaymentExecutionFee;

  // BIAN SD-254 transaction description (not CHD - plaintext, no QE)
  // cardTransactionDescription: statement descriptor visible on the cardholder's bank statement (max 22 chars)
  // cardTransactionNarrative: extended free-text context for L1/L2 fraud investigation
  cardTransactionDescription: string;
  cardTransactionNarrative?: string;

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

export type CardTransactionType =
  | 'purchase'
  | 'cash_advance'
  | 'balance_transfer'
  | 'refund'
  | 'fee'
  | 'adjustment';

export type CardTransactionChannel = 'online' | 'pos' | 'contactless' | 'atm';

export type CardTransactionInitiationType =
  | 'customerInitiated'
  | 'merchantInitiated';

// The bank's own record of a payment a TPP initiated. Distinct from the PSP's instruction record: the
// PSP holds what it was asked to do, the bank holds what it is executing, and each side owns its own
// lifecycle. They are correlated by the end to end identification, not by sharing a row.
export const PAYMENT_INITIATION_COLLECTION = 'paymentInitiationProcedure';

// Berlin Group payment products, which are part of the endpoint path rather than a body field. The
// product is the TPP's choice of scheme; how the bank actually reaches the creditor is its own business.
export type PaymentProduct =
  | 'sepa-credit-transfers'
  | 'instant-sepa-credit-transfers'
  | 'cross-border-credit-transfers';

export const PAYMENT_PRODUCTS: PaymentProduct[] = [
  'sepa-credit-transfers',
  'instant-sepa-credit-transfers',
  'cross-border-credit-transfers',
];

// ISO 20022 external payment transaction status codes, which is what Berlin Group carries as
// `transactionStatus`. No bespoke status: a TPP already knows these.
//   RCVD received, ACTC technically validated, ACCP accepted against the customer profile,
//   ACSP settlement in process, ACSC settlement completed, RJCT rejected, CANC cancelled, PDNG pending.
export type TransactionStatus = 'RCVD' | 'ACTC' | 'ACCP' | 'ACSP' | 'ACSC' | 'RJCT' | 'CANC' | 'PDNG';

// Once a payment is presented for settlement it is irrevocable, so these are the only states from which
// a cancellation can be honoured. Kept as data rather than a condition buried in the handler, because
// this is the boundary between reversible and not.
export const CANCELLABLE_STATUSES: TransactionStatus[] = ['RCVD', 'ACTC', 'ACCP', 'PDNG'];

export interface PaymentPartyAccount {
  // The debtor is one of this bank's accounts, so it is held by its own reference plus its IBAN.
  accountReference?: string;
  iban: string;
}

export interface PaymentInitiationControlRecord {
  // The standard's paymentId.
  paymentInitiationInstanceReference: string;
  paymentProduct: PaymentProduct;
  // Which TPP initiated it and under which consent, so every payment is attributable.
  paymentInitiatingTppClientId: string;
  bankConsentAgreementInstanceReference: string;
  paymentDebtor: PaymentPartyAccount;
  paymentCreditor: PaymentPartyAccount;
  paymentCreditorName: string;
  paymentCreditorAgentBic?: string;
  paymentInstructedAmount: number;
  paymentCurrency: string;
  paymentRemittanceInformation?: string;
  // ISO 20022 EndToEndId, the id that survives across the several calls one payment is made of.
  paymentEndToEndIdentification: string;
  paymentRequestedExecutionDate?: string;
  transactionStatus: TransactionStatus;
  transactionStatusReason?: string;
  transactionStatusChangedDateTime: string;
  // Correlation of the initiating call, for the audit trail across both services.
  paymentCorrelationId?: string;
  bianServiceDomain: string;
  bianControlRecordType: 'PaymentInitiation';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}

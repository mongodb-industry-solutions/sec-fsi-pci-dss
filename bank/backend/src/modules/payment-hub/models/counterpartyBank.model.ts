// Which institutions this bank can actually reach, and how.
//
// It exists so "can I pay this beneficiary" is ANSWERABLE rather than assumed. Without it, an unreachable
// destination is discovered by attempting the payment and losing it, which is the failure mode that makes a
// customer call support about money that left their account and arrived nowhere.
//
// bankcore never calls another bank directly: it presents the operation to a clearing scheme and the scheme
// credits the beneficiary. So the only things needed about a counterparty are its BIC, the schemes that
// reach it, and a correspondent where one is required.
export const COUNTERPARTY_BANK_COLLECTION = 'counterpartyBank';
export const INTERBANK_MESSAGE_LOG_COLLECTION = 'interbankMessageLog';

// The schemes this bank participates in. A destination reachable by none of them is refused with a reason.
export type ClearingScheme = 'sepa' | 'sepa_instant' | 'ach' | 'swift';

export interface CounterpartyBankControlRecord {
  counterpartyBankInstanceReference: string;
  counterpartyBankName: string;
  // ISO 9362. The identity a scheme routes on.
  counterpartyBankBic: string;
  counterpartyBankCountryCode: string;
  // The national bank identifiers this institution owns, so an IBAN resolves to it without a lookup table.
  counterpartyBankIbanBankCodes: string[];
  counterpartyBankSchemes: ClearingScheme[];
  // Required for a corridor where no direct scheme membership exists, which is what SWIFT correspondent
  // banking is for. Absent means the schemes above reach it directly.
  counterpartyBankCorrespondentBic?: string;
  // Local time of day after which a submission lands on the next business day. Modelled because a customer
  // asking "why is it not there yet" is answered by this, not by a support ticket.
  counterpartyBankCutOffTime?: string;
  counterpartyBankStatus: 'reachable' | 'unreachable';
  bianServiceDomain: string;
  bianControlRecordType: 'CounterpartyBank';
  recordCreatedDateTime: string;
  recordUpdatedDateTime?: string;
  schemaVersion: number;
}

// ── The interbank trail ──────────────────────────────────────────────────────────────────────────

// The ISO 20022 messages this bank sends and receives. `pacs.008` is the credit transfer it presents,
// `pacs.002` the scheme's status report, `pacs.004` a return after settlement.
export type InterbankMessageType = 'pacs.008' | 'pacs.002' | 'pacs.004';

export interface InterbankMessageLogRecord {
  interbankMessageLogInstanceReference: string;
  interbankMessageType: InterbankMessageType;
  interbankMessageDirection: 'sent' | 'received';
  // The payment this message belongs to, and the end to end id that survives across all of them.
  paymentInitiationInstanceReference: string;
  interbankEndToEndIdentification: string;
  // The scheme's own reference for the message, which is what a reconciliation quotes.
  interbankMessageIdentification: string;
  interbankScheme: ClearingScheme;
  interbankCreditorBic?: string;
  interbankAmount: number;
  interbankCurrency: string;
  // The status the message carried, in the scheme's vocabulary (ACSP, ACSC, RJCT) plus its reason code.
  interbankStatus?: string;
  interbankReasonCode?: string;
  // The message itself, as the structure that was sent or received. Kept because a reconciliation that
  // cannot show what was presented is an assertion rather than evidence.
  interbankMessagePayload: Record<string, unknown>;
  recordCreatedDateTime: string;
  schemaVersion: number;
}

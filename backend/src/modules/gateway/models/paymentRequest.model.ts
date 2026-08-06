// BIAN SD-65 Payment Order: Request to Pay (RTP), the canonical, rail-agnostic request record (v28).
// RTP is an INTENT domain, separate from payment execution: on accept a distinct
// paymentExecutionProcedure (SD-65) is created and linked by immutable reference.
// RTP is account/alias-based → OUTSIDE PCI scope (no PAN/CHD). Sensitive PII is GDPR-minimized:
// aliases are stored as a non-reversible SHA-256 hash for indexing plus a QE:none plaintext for L2 display;
// free-text remittance / structured address / payee name are QE:none (L2 only).

export const PAYMENT_REQUEST_COLLECTION = 'paymentRequestProcedure';

// Monotonic lifecycle (spec §"Functional lifecycle"). Transitions validated by the state-machine helper.
export type PaymentRequestStatus =
  | 'draft'
  | 'created'
  | 'validated'
  | 'presented'
  | 'delivered'
  | 'viewed'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'payment_initiated'
  | 'payment_processing'
  | 'payment_settled'
  | 'payment_failed'
  | 'reversed'
  | 'disputed';

export type PaymentRequestRail = 'sepa' | 'ach' | 'swift' | 'local_bank';
export type PresentationChannel = 'in_app' | 'qr' | 'link' | 'email';
export type DeliveryChannel = 'in_app' | 'qr' | 'link' | 'email';

// Embedded machine-readable screening / policy outcome (FDS/HRP/AML/VoP).
export interface PaymentRequestPolicyDecision {
  policyType: 'fds' | 'hrp' | 'aml' | 'vop' | 'funds' | 'account';
  outcome: string;               // e.g. 'clear' | 'block' | 'match' | 'no_match' | 'insufficient'
  reason?: string;
  score?: number;
  decidedAt: Date;
}

// ISO 20022-aligned structured remittance (Nov-2026 SEPA readiness).
export interface StructuredRemittance {
  referenceType?: string;        // e.g. 'SCOR' (structured creditor reference)
  reference?: string;
  additionalInfo?: string;
}

// SEPA structured/hybrid address (stored from day one to avoid the 15-Nov-2026 unstructured reject).
export interface StructuredAddress {
  streetName?: string;
  buildingNumber?: string;
  postCode?: string;
  townName?: string;
  countrySubDivision?: string;
  country?: string;             // ISO 3166-1 alpha-2
}

// Durable in-app approval context (session, device, timestamp, auth result). NOT CIBA in v28.
export interface AuthorizationContext {
  authMethod: 'session_jwt' | 'oauth_session';
  subject: string;              // partyRef / OAuth subject
  channel: PresentationChannel;
  deviceUserAgent?: string;
  authenticatedAt: Date;
  authResult: 'approved' | 'rejected';
}

export interface PaymentRequestProcedure {
  paymentRequestInstanceReference: string;   // UUID, PK
  requestVersion: number;                     // canonical schema version (spec)

  // Requester (payee: receives funds)
  requesterPartyReference: string;            // FK → party (SD-13)
  requesterPspId?: string;
  payeeName?: string;                         // QE:none (DEK-rtp-payee-name), L2 only
  payeeCounterpartyReference?: string;        // FK → counterpartyArrangement (SD-54)
  payeeAlias?: string;                        // QE:none (DEK-rtp-payee-alias), L2 plaintext display
  payeeAliasHash?: string;                    // SHA-256(alias), indexed, non-reversible
  payeeReceivingAccountReference: string;     // FK → payoutAccountArrangement (required at create)

  // Payer (approves + funds)
  payerPartyReference?: string;               // resolved payer (FK → party)
  payerCounterpartyReference?: string;        // FK → counterpartyArrangement (SD-54): the requester's
                                              // beneficiary that represents the payer (for the payee's link)
  payerAlias?: string;                        // QE:none (DEK-rtp-payer-alias)
  payerAliasHash?: string;                    // SHA-256(alias), indexed
  payerPspId?: string;
  payerFundingAccountReference?: string;      // chosen at approval; else payer default account

  amount: number;
  currency: string;                           // ISO 4217

  purpose?: string;
  invoiceReference?: string;
  personOrMerchantReference?: string;

  dueAt?: Date;
  expiresAt: Date;

  allowPartialPayment: boolean;
  allowMultiplePayments: boolean;

  supportedRails: PaymentRequestRail[];       // constrained to railResolver-supported rails
  preferredRail?: PaymentRequestRail;

  structuredRemittance?: StructuredRemittance;
  unstructuredRemittance?: string;            // QE:none (DEK-rtp-remittance), L2 only
  structuredAddress?: StructuredAddress;      // QE:none (DEK-rtp-address), L2 only

  riskFlags: string[];
  policyDecisions: PaymentRequestPolicyDecision[];

  status: PaymentRequestStatus;
  presentationChannel: PresentationChannel;
  deliveryChannel?: DeliveryChannel;

  authorizationContext?: AuthorizationContext;   // set on accept/reject, immutable
  qrRepresentationReference?: string;            // FK → qrPaymentRepresentation (§3.4)
  linkedPaymentExecutionReference?: string;      // set on accept, immutable once set

  // v35 CH-4: `originalPayload` removed (unused free-shape field, minimization risk. GDPR Art. 5(1)(c)).

  idempotencyKey?: string;

  bianServiceDomain: 'Payment Order';
  bianControlRecordType: 'PaymentRequestProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

// BIAN SD-65: Payment Execution — settlement lifecycle record
// Created after authorization; tracks the full journey from routing to completion.
// resolutionLog is append-only and captures every beneficiary resolution step for PCI audit.

import type { PayoutRail } from './payoutAccount.model';

export const PAYMENT_EXECUTION_COLLECTION = 'paymentExecutionProcedure';

export type PaymentExecutionStatus =
  | 'pending'     // created, not yet routed
  | 'routing'     // beneficiary resolution in progress
  | 'scheduled'   // destination resolved; waiting for T+N settlement window
  | 'in_flight'   // funds dispatched to payout rail
  | 'completed'   // settlement confirmed
  | 'failed'      // terminal failure
  | 'exception'   // blocked: no eligible destination; manual review required
  | 'refunded'    // reversed post-settlement
  | 'reversed';   // rolled back before settlement

export type BeneficiaryType = 'merchant' | 'user' | 'anonymous';

export interface PaymentExecutionResolutionStep {
  stepName: string;
  stepOutcome: 'found' | 'not_found' | 'fallback' | 'failed';
  stepNote?: string;
  stepDateTime: Date;
}

// v18 (SD-65 / SD-89): merchant-commission ATTRIBUTION sub-doc. The numeric commission amount stays
// in the flat `feeAmount` field (single source of truth — do NOT duplicate it here); this sub-doc only
// records WHO the fee belongs to and HOW it was derived, so the merchant dashboard can aggregate
// commission revenue (SD-89) from the execution record (SD-65). Not CHD → NOT QE-encrypted.
export interface PaymentExecutionFee {
  feeMerchantReference: string;   // FK → merchantAgreementInstanceReference (SD-89) the fee is attributed to
  feeRateApplied: number;         // commission rate 0..1 applied at capture time
  feeCollectedDateTime: Date;     // when the commission was collected
}

export interface PaymentExecutionProcedure {
  paymentExecutionInstanceReference: string;      // UUID, PK
  paymentOrderInstanceReference: string;          // FK → paymentOrderProcedure (SD-64)
  cardTransactionInstanceReference?: string;      // FK → cardTransactionLog (SD-254)

  beneficiaryType: BeneficiaryType;
  beneficiaryPartyReference?: string;             // FK → party (SD-13) for user payouts
  initiatorPartyReference?: string;               // FK → party (SD-13); set for P2P transfers (enables customer-scoped history)
  sourcePayoutAccountReference?: string;          // FK → payoutAccountArrangement (SD-66); sender's account — enables per-account movement ledger
  resolvedPayoutAccountReference?: string;        // FK → payoutAccountArrangement (SD-66); recipient's account

  beneficiaryArrangementReference?: string;       // FK → counterpartyArrangement (SD-54); set for P2P-to-beneficiary transfers → enables link to the beneficiary

  // v18 (SD-89): the merchant that INITIATED this execution via the merchant portal (OAuth on-behalf-of).
  // Set only when the operation originates from a merchant client; PSP-direct customer transfers leave it
  // unset. Enables merchant data isolation: a merchant's transaction history shows only its own activity for
  // the user, never the user's activity in other merchants or directly in the PSP. Not CHD → NOT QE-encrypted.
  merchantAgreementReference?: string;            // FK → merchantAgreementInstanceReference (SD-89)

  // External bank-transfer recipient identity (SEPA/ACH/SWIFT to an unregistered account).
  // GDPR Art. 32 / PSD2 (NOT PCI DSS — that governs card data). destinationIban is QE:none
  // (encrypted at rest, L2-only), shown full to the account owner; the masked form stays
  // plaintext for list views. beneficiaryName/destinationCountry are display metadata.
  beneficiaryName?: string;                       // holder legal name as entered at initiation
  destinationIban?: string;                       // full destination IBAN — QE:none (DEK-exec-dest-iban), L2 only
  destinationAccountMasked?: string;              // masked IBAN / account, e.g. "ES12••••5477"
  destinationCountry?: string;                    // ISO 3166-1 alpha-2 (destination banking country)

  grossAmount: number;
  netAmount: number;
  feeAmount: number;                              // commission/processing amount (numeric source of truth)
  fee?: PaymentExecutionFee;                      // v18: merchant-commission attribution (see PaymentExecutionFee)
  currency: string;                               // ISO 4217 — sender's currency

  // FX fields — populated only for cross-currency transfers
  recipientCurrency?: string;                     // ISO 4217 — recipient's account currency
  recipientAmount?: number;                       // amount credited after FX conversion
  fxRate?: number;                                // sender → recipient rate at execution time

  paymentExecutionRail?: PayoutRail;
  routingNote?: string;

  paymentExecutionStatus: PaymentExecutionStatus;
  failureReason?: string;
  scheduledAt?: Date;
  initiatedAt?: Date;
  completedAt?: Date;

  resolutionLog: PaymentExecutionResolutionStep[]; // append-only, never cleared

  bianServiceDomain: 'Payment Execution';
  bianControlRecordType: 'PaymentExecutionProcedure';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
  schemaVersion: number;
}

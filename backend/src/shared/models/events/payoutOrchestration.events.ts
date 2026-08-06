// Payout Orchestration Bus Payload Contracts (v17)
// BIAN SD-65 Payment Execution · SD-66 Payment Initiation · SD-36 Open Banking AIS
//
// Rule: IBAN NEVER travels on the bus. Adapters resolve IBAN from the QE vault
// (L2 client) just before dispatching the wire. Bus events carry only opaque references.

import type { BeneficiaryType } from '../../../modules/gateway/models/paymentExecution.model';

// ── Saga trigger ─────────────────────────────────────────────────────────────

export interface PayoutOrchestrationTriggered {
  paymentOrderInstanceReference: string;
  cardTransactionInstanceReference: string;
  merchantAgreementInstanceReference?: string;
  beneficiaryType: BeneficiaryType;
  beneficiaryPartyReference?: string;       // set for user-to-user payouts
  grossAmount: number;
  currency: string;
}

// ── AIS: Account Information Service (SD-36 Open Banking) ───────────────────

export interface AisAccountValidationRequested {
  paymentExecutionInstanceReference: string;
  payoutAccountInstanceReference: string;   // PSP reference, wire adapter resolves IBAN via L2 vault
  accountCountryCode: string;
  accountCurrency: string;
  requestedFields: ('balance' | 'identity' | 'status')[];
  consentReference?: string;
}

export interface AisAccountValidationCompleted {
  paymentExecutionInstanceReference: string;
  payoutAccountInstanceReference: string;
  accountVerified: boolean;
  accountStatus: 'active' | 'dormant' | 'closed' | 'unknown';
  identityMatch?: 'full' | 'partial' | 'failed' | 'not_checked';
  balancePending?: number;
  balanceAvailable?: number;
  currency?: string;
  providerReference?: string;
}

// ── Execution lifecycle ───────────────────────────────────────────────────────

export interface PayoutExecutionCreated {
  paymentExecutionInstanceReference: string;
  beneficiaryType: BeneficiaryType;
  resolvedPayoutAccountReference?: string;
  grossAmount: number;
  netAmount: number;
  currency: string;
  status: 'scheduled' | 'exception';
  scheduledAt?: string;                     // ISO 8601
  exceptionReason?: string;
}

// ── Bank transfer: payment-initiation provider (SD-66 PISP) ─────────────────

export interface BankTransferSubmitted {
  paymentExecutionInstanceReference: string;
  railRef: string;
  railType: string;
  submittedAt: string;                      // ISO 8601
}

export interface BankTransferSettled {
  paymentExecutionInstanceReference: string;
  railRef: string;
  completedAt: string;                      // ISO 8601
  netAmount: number;
  currency: string;
}

export interface BankTransferFailed {
  paymentExecutionInstanceReference: string;
  railRef?: string;
  errorCode: string;
  errorReason: string;
}

// ── Completion + balance ──────────────────────────────────────────────────────

export interface PayoutExecutionCompleted {
  paymentExecutionInstanceReference: string;
  cardTransactionInstanceReference: string;
  netAmount: number;
  currency: string;
  completedAt: string;                      // ISO 8601
}

export interface BalanceCredited {
  payoutAccountInstanceReference: string;
  creditedAmount: number;
  newAvailableAmount: number;
  currency: string;
}

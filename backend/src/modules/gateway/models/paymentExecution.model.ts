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

export interface PaymentExecutionProcedure {
  paymentExecutionInstanceReference: string;      // UUID, PK
  paymentOrderInstanceReference: string;          // FK → paymentOrderProcedure (SD-64)
  cardTransactionInstanceReference?: string;      // FK → cardTransactionLog (SD-254)

  beneficiaryType: BeneficiaryType;
  beneficiaryPartyReference?: string;             // FK → party (SD-13) for user payouts
  initiatorPartyReference?: string;               // FK → party (SD-13); set for P2P transfers (enables customer-scoped history)
  resolvedPayoutAccountReference?: string;        // FK → payoutAccountArrangement (SD-66)

  grossAmount: number;
  netAmount: number;
  feeAmount: number;
  currency: string;                               // ISO 4217

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

// Fraud Diagnosis (no QE: operational metadata only)

import { RiskSeverity } from '../../../shared/models/risk.model';
import { AnalystRole } from '../../../shared/models/identity.model';
import { TransactionSnapshot } from '../../../shared/models/transaction.model';

export { RiskSeverity, AnalystRole };

export const FRAUD_DIAGNOSIS_COLLECTION = 'fraudDiagnosisCase';
export const FRAUD_DIAGNOSIS_EVENTS_COLLECTION = 'fraudDiagnosisCaseEvents';

// `same_owner` is its own kind (v37 P5.5). The investigation read-model resolves a counterparty from this
// value, and a transfer between two accounts of one owner HAS none: defaulting it to `bank_transfer` sent an
// investigator looking for a beneficiary who does not exist.
export type FraudCaseTransactionKind = 'card' | 'p2p' | 'bank_transfer' | 'rtp' | 'same_owner';

export interface FraudDiagnosisControlRecord {
  // Identifiers
  fraudDiagnosisInstanceReference: string;               // UUID, primary key
  fraudDiagnosisCaseReference: string;                   // FD-2026-001234

  // Links to protected records (plaintext keys by design: no PII in these refs)
  cardTransactionInstanceReference: string;              // FK to cardTransactionLog 
  customerAgreementInstanceReference: string;            // FK to customerAgreementProcedure 
  paymentExecutionInstanceReference?: string;            // FK to paymentExecutionProcedure ; set for every non-card case
  paymentRequestInstanceReference?: string;              // FK to paymentRequestProcedure ; set for RTP cases
  // Movement discriminator; absent = 'card' for legacy docs. Drives which counterparty the
  // investigation read-model resolves (acquired merchant vs registered beneficiary vs payee).
  transactionKind?: FraudCaseTransactionKind;

  // Extended Reference Pattern: stable display fields from cardTransaction.
  // Embedded to make fraud investigation display a single-collection query.
  // Updated only when transaction status changes (controlled write path).
  transactionSnapshot: TransactionSnapshot;

  // Case lifecycle
  fraudDiagnosisCaseStatus: FraudDiagnosisCaseStatus;
  fraudDiagnosisCaseSeverity: RiskSeverity;
  fraudDiagnosisRequestDateTime: Date;
  fraudDiagnosisCaseClosingDateTime?: Date;

  // Assignment (v2: populated when case is assigned)
  fraudDiagnosisAnalystInstanceReference?: string;       // FK to customerAuthenticationAssessment (L1)
  fraudDiagnosisInvestigatorInstanceReference?: string;  // FK to customerAuthenticationAssessment (L2)

  // Assessment
  fraudDiagnosisAssessment: {
    riskIndicators: string[];
    fraudDiagnosisScore?: number;                        // 0–100
    fraudDiagnosisConclusion?: string;
  };

  // Escalation record (populated when status becomes escalated)
  fraudDiagnosisEscalationRecord?: {
    escalationDateTime: Date;
    escalationReason: string;
    escalatedByInstanceReference: string;
    escalatedToInstanceReference: string;
  };

  // Set when L2 approves the escalation; cleared when L2 rejects it back to L1
  fraudDiagnosisEscalationAcceptedAt?: Date | null;

  /**
   * @deprecated Use POST /api/v1/fraud/:id/notes with visibility:'internal' instead.
   * Kept for reading legacy data only. New writes are rejected by the API.
   */
  fraudDiagnosisCaseNotes?: string;

  /**
   * @deprecated Use POST /api/v1/fraud/:id/notes with visibility:'customer' instead.
   * Kept for reading legacy data only. New writes are rejected by the API.
   */
  fraudDiagnosisCustomerSubjectNotes?: string;

  // Resolution record (populated on close)
  fraudDiagnosisResolutionRecord?: {
    resolutionDateTime: Date;
    resolutionOutcome: ResolutionOutcome;
    resolutionNotes: string;
    resolvedByInstanceReference: string;
  };

  // AI agent draft (v3: populated by agent, absent if agent disabled)
  agentDraftDiagnosis?: {
    riskSummary: string;
    recommendedAction: 'clear' | 'escalate' | 'investigate';
    confidenceScore: number;                             // 0–100
    supportingEvidence: string[];
    agentCompletionDateTime: Date;
  };

  // BIAN metadata
  bianServiceDomain: 'Fraud Diagnosis';
  bianControlRecordType: 'FraudDiagnosis';
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;

  // Schema Versioning Pattern: enables zero-downtime schema evolution across v1–v4
  schemaVersion: number;
}

// Audit event document, stored in fraudDiagnosisCaseEvents (separate collection).
// Replaces the embedded diagnosisActionLog array (Unbounded Array anti-pattern fix).
// Indexed on (fraudDiagnosisInstanceReference, actionDateTime) for ordered retrieval.
//
// actionDetails shape per actionType:
//   note_added:     { noteId: string, noteText: string, visibility: 'internal'|'customer' }
//   note_retracted: { noteId: string, retractedNoteId: string, retractionReason: string|null, visibility: string }
//   escalated:      { escalationReason: string, escalationDateTime: string }
//   field_accessed: { action: string, ... }
//   assigned:       { action?: string, newStatus?: string }
//   resolved:       { newStatus: string, resolutionOutcome?: string }
export interface FraudDiagnosisCaseEventRecord {
  fraudDiagnosisInstanceReference: string;               // FK to fraudDiagnosisCase
  actionDateTime: Date;
  actionType: ActionType;
  performedByInstanceReference: string;   // unique acting-user id (partyRef/sub), PCI DSS
  performedByName?: string;                // acting user's display name (shown in the activity log)
  performedByRole: AnalystRole;
  actionDetails: Record<string, unknown>;
  schemaVersion: number;
}

export type FraudDiagnosisCaseStatus =
  | 'open'
  | 'under_review'
  | 'escalated'
  | 'resolved_cleared'
  | 'resolved_fraud'
  | 'closed';

export type ActionType =
  | 'case_opened'
  | 'assigned'
  | 'note_added'
  | 'note_retracted'
  | 'field_accessed'
  | 'escalated'
  | 'ai_review'
  | 'resolved'
  | 'reopened'            // a resolved/closed case was reopened for further review
  | 'closed'
  | 'question_created'    // investigator posed a question to the customer
  | 'question_answered';  // customer submitted an (immutable) response

export type ResolutionOutcome = 'cleared' | 'confirmed_fraud' | 'referred';

// BIAN SD-83: Fraud Diagnosis (no QE: operational metadata only)

import { RiskSeverity } from '../../../shared/models/risk.model';
import { AnalystRole } from '../../../shared/models/identity.model';
import { TransactionSnapshot } from '../../../shared/models/transaction.model';

export { RiskSeverity, AnalystRole };

export const FRAUD_DIAGNOSIS_COLLECTION = 'fraudDiagnosisCase';
export const FRAUD_DIAGNOSIS_EVENTS_COLLECTION = 'fraudDiagnosisCaseEvents';

export interface FraudDiagnosisControlRecord {
  // Identifiers
  fraudDiagnosisInstanceReference: string;               // UUID, primary key
  fraudDiagnosisCaseReference: string;                   // FD-2026-001234

  // Links to protected records (plaintext keys by design: no PII in these refs)
  cardTransactionInstanceReference: string;              // FK to cardTransactionLog (SD-254)
  customerAgreementInstanceReference: string;            // FK to customerAgreementProcedure (SD-53)

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

  // Operational notes (appended by analysts, visible to L1/L2/Auditor)
  fraudDiagnosisCaseNotes?: string;

  // Customer-facing notes (visible to the customer in their transaction detail view)
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
export interface FraudDiagnosisCaseEventRecord {
  fraudDiagnosisInstanceReference: string;               // FK to fraudDiagnosisCase
  actionDateTime: Date;
  actionType: ActionType;
  performedByInstanceReference: string;
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
  | 'field_accessed'
  | 'escalated'
  | 'ai_review'
  | 'resolved'
  | 'closed';

export type ResolutionOutcome = 'cleared' | 'confirmed_fraud' | 'referred';

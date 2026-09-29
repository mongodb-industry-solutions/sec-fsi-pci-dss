// Bus payload contracts for the `fraud_investigation` process (architecture §7.2).
// correlationId = transactionId for AML; = caseRef for the case-lifecycle events.

/**
 * @event    aml.monitoring.requested
 * @producer psp.core (PostAuthorizationProcess)  @consumer AML provider group
 * @note     Reference-led; the AML adapter assembles AmlMonitoringOutbound (§7.7) JIT.
 */
export interface AmlMonitoringRequested {
  accountReference?: string;                // -> resolve account 30d volume/velocity, corridors
  counterpartyReference?: string;           // beneficiary/merchant party, if applicable
}

/**
 * @event    aml.monitoring.completed
 * @producer callback.aml  @consumer PostAuthorizationProcess
 */
export interface AmlMonitoringCompleted {
  outcome: 'clear' | 'alert';
  severity?: 'low' | 'medium' | 'high';
  alertType?: string;                       // "structuring" | "velocity" | ...
  requiresReview?: boolean;
}

/**
 * @event    fraud.case.opened
 * @producer psp.core  @consumer Case view (SSE), investigators
 */
export interface FraudCaseOpened {
  transactionId: string;                    // cross-link to the payment journey
  accountReference?: string;
  reason: string;                           // "fds_review" | "aml_alert" | ...
  priority?: 'low' | 'medium' | 'high';
  openedBy?: string;                        // 'system' | partyRef
}

/**
 * @event    fraud.case.enriched
 * @producer psp.core (PostAuthorizationProcess)  @consumer Case view (SSE), investigators
 */
export interface FraudCaseEnriched {
  transactionId: string;
  subsystemSignals: {                       // derived: each gate's outcome collapsed per subsystem
    issuer: { approved: boolean; responseCode: string | null } | null;
    fds:    { approved: boolean; reason: string | null } | null;
    hrp:    { approved: boolean; reason: string | null } | null;
    aml:    { alert: boolean; severity: string | null } | null;
  };
}

/**
 * @event    fraud.question.created
 * @producer psp.core  @consumer Customer (app/SSE), case view
 */
export interface FraudQuestionCreated {
  questionId: string;
  transactionId?: string;
  prompt: string;                           // question text shown to the customer
  channel?: 'app' | 'email' | 'sms';
}

/**
 * @event    fraud.question.answered
 * @producer psp.core  @consumer Case view (SSE), investigator
 */
export interface FraudQuestionAnswered {
  questionId: string;
  transactionId?: string;
  answer: string;
  answeredAt: string;                       // ISO-8601
}

/**
 * @event    fraud.case.updated
 * @producer psp.core  @consumer Case view (SSE)
 */
export interface FraudCaseUpdated {
  transactionId?: string;
  status: 'open' | 'investigating' | 'escalated_l2' | 'resolved' | 'closed';
  resolution?: 'confirmed_fraud' | 'cleared' | 'chargeback';
  updatedBy?: string;                       // analyst partyRef
  note?: string;
}

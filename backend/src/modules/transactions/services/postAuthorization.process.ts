import { Db } from 'mongodb';
import { EventBus, DomainEvent, makeEvent, MongoEventStore } from '../../../vendors/eventbus';
import { dispatchProvider } from '../../providers/services/integrationDispatch.service';
import { emitProcessEvent } from '../../providers/services/businessProcessEvent.service';
import { CARD_TRANSACTION_COLLECTION } from '../models/cardTransaction.model';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../fraud/models/fraudDiagnosis.model';

// Phase 2 (dev.v8 F5): post-authorization, async. AML monitoring runs after the payment is authorized
// (it never blocks the payment), and the investigation case is ENRICHED from the correlated subsystem
// signals (issuer + FDS + sanctions + AML) so an investigator sees the full picture in one place.

export interface SubsystemSignals {
  issuer: { approved: boolean; responseCode: string | null } | null;
  fds: { approved: boolean; reason: string | null } | null;
  sanctions: { approved: boolean; reason: string | null } | null;
  aml: { alert: boolean; severity: string | null } | null;
}

// Pure: collapse a journey's event trail into the latest verdict per subsystem.
export function extractSubsystemSignals(events: DomainEvent[]): SubsystemSignals {
  const latest = (type: string) => [...events].reverse().find((e) => e.eventType === type)?.payload as Record<string, unknown> | undefined;
  const issuer = latest('cardissuer.validation.completed');
  const fds = latest('fraud.scoring.completed');
  const sanctions = latest('sanctions.screening.completed');
  const aml = latest('aml.monitoring.completed');
  return {
    issuer: issuer ? { approved: issuer.approved !== false, responseCode: (issuer.responseCode as string) ?? null } : null,
    fds: fds ? { approved: fds.approved !== false, reason: (fds.reason as string) ?? null } : null,
    sanctions: sanctions ? { approved: sanctions.approved !== false, reason: (sanctions.reason as string) ?? null } : null,
    aml: aml ? { alert: !!aml.alert, severity: (aml.severity as string) ?? null } : null,
  };
}

export class PostAuthorizationProcess {
  private readonly store: MongoEventStore;
  constructor(private readonly db: Db, private readonly bus: EventBus) {
    this.store = new MongoEventStore(db);
  }

  register(): void {
    this.bus.subscribe('payment.authorized', (e) => this.onAuthorized(e));
    this.bus.subscribe('aml.monitoring.completed', (e) => this.onAmlCompleted(e));
  }

  private async onAuthorized(e: DomainEvent): Promise<void> {
    const txnId = e.correlationId;
    const p = e.payload as { fraudCaseCreated?: boolean; fraudDiagnosisInstanceReference?: string };
    await this.runAmlMonitoring(txnId);
    if (p.fraudCaseCreated && p.fraudDiagnosisInstanceReference) {
      await this.enrichCase(txnId, p.fraudDiagnosisInstanceReference);
    }
  }

  // AML transaction monitoring, post-auth. May raise an alert; never blocks the (already done) payment.
  private async runAmlMonitoring(txnId: string): Promise<void> {
    let alert = false;
    let severity: string | undefined;
    try {
      const txn = await this.db.collection<{ cardTransactionAmount?: { amount: number; currency: string }; cardTransactionAccountReference?: string; cardTransactionMerchantName?: string }>(CARD_TRANSACTION_COLLECTION)
        .findOne({ cardTransactionInstanceReference: txnId }, { projection: { _id: 0, cardTransactionAmount: 1, cardTransactionAccountReference: 1, cardTransactionMerchantName: 1 } });
      const r = await dispatchProvider(this.db, 'aml_monitoring', 'aml.monitoring.requested', {
        cardTransactionInstanceReference: txnId,
        amount: txn?.cardTransactionAmount?.amount,
        accountReference: txn?.cardTransactionAccountReference,
        merchantName: txn?.cardTransactionMerchantName,
      }, { entityType: 'transaction', entityId: txnId, processType: 'aml_screening' });
      const b = r.responseBody as { requiresReview?: boolean; alertLevel?: string; alertType?: string; severity?: string } | undefined;
      if (b && (b.requiresReview || (b.alertLevel && b.alertLevel !== 'none') || b.alertType)) { alert = true; severity = b.severity ?? b.alertLevel; }
    } catch { /* AML failure never affects the authorized payment */ }

    void this.bus.publish(makeEvent({
      eventType: 'aml.monitoring.completed', correlationId: txnId, businessProcess: 'fraud_investigation', source: 'callback.aml',
      payload: { transactionId: txnId, alert, severity }, bian: { serviceDomain: 'SD-99 AML', controlRecord: 'SuspiciousActivityAnalysisAssessment' },
    }));
  }

  // Attach the correlated subsystem signals to the case so the investigation has them in one place.
  private async enrichCase(txnId: string, caseRef: string): Promise<void> {
    const signals = extractSubsystemSignals(await this.store.trail(txnId));
    await this.db.collection(FRAUD_DIAGNOSIS_COLLECTION).updateOne(
      { fraudDiagnosisInstanceReference: caseRef },
      { $set: { subsystemSignals: signals, recordUpdatedDateTime: new Date() } },
    );
    emitProcessEvent(this.db, {
      entityType: 'fraud_case', entityId: caseRef, processType: 'fraud_evaluation',
      processAction: 'fraud.investigation.case.enriched', processOutcome: 'pending',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: { cardTransactionInstanceReference: txnId, signals },
      bianServiceDomain: 'SD-83 Fraud Diagnosis', bianControlRecordType: 'FraudDiagnosisCase',
    });
  }

  // A late AML alert enriches the case too (if one exists for the transaction).
  private async onAmlCompleted(e: DomainEvent): Promise<void> {
    if (!(e.payload as { alert?: boolean }).alert) return;
    const caseDoc = await this.db.collection<{ fraudDiagnosisInstanceReference: string }>(FRAUD_DIAGNOSIS_COLLECTION)
      .findOne({ cardTransactionInstanceReference: e.correlationId }, { projection: { _id: 0, fraudDiagnosisInstanceReference: 1 } });
    if (caseDoc) await this.enrichCase(e.correlationId, caseDoc.fraudDiagnosisInstanceReference);
  }
}

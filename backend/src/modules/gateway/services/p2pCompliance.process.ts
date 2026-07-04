// BIAN SD-83 / SD-65: post-transfer compliance checks for P2P payments.
// Mirrors the card-payment PostAuthorizationProcess: runs FDS, HRP, AML in parallel
// and opens a FraudDiagnosisCase if any gate flags the transfer.
// PCI DSS Req 10: every check produces a compliance event.

import { Db } from 'mongodb';
import { EventBus, DomainEvent, makeEvent, MongoEventStore } from '../../../vendors/eventbus';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { emitProcessEvent } from '../../provider/services/businessProcessEvent.service';
import { createFraudCase } from '../../fraud/services/fraudDiagnosis.service';
import { extractSubsystemSignals } from '../../transaction/services/postAuthorization.process';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../fraud/models/fraudDiagnosis.model';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';

interface P2PTransferPayload {
  transferRef: string;
  amount: number;
  currency: string;
  initiatorPartyRef: string;
  sourceAccountRef: string;
  recipientAccountRef: string;
}

export class P2PComplianceProcess {
  private readonly store: MongoEventStore;
  constructor(private readonly db: Db, private readonly bus: EventBus) {
    this.store = new MongoEventStore(db);
  }

  register(): void {
    this.bus.subscribe('p2p.transfer.completed', (e) => this.onTransferCompleted(e));
  }

  private async onTransferCompleted(e: DomainEvent): Promise<void> {
    const p = e.payload as unknown as P2PTransferPayload;
    const transferRef = p.transferRef ?? e.correlationId;
    const { amount, currency, initiatorPartyRef, sourceAccountRef } = p;

    // Run FDS, HRP, AML in parallel — none block the completed transfer
    const [fds, hrp, aml] = await Promise.allSettled([
      this.runFds(transferRef, amount, currency),
      this.runHrp(transferRef, initiatorPartyRef),
      this.runAml(transferRef, amount, sourceAccountRef),
    ]);

    const fdsR = fds.status === 'fulfilled' ? fds.value : { flag: false, score: 0, reason: undefined as string | undefined };
    const hrpR = hrp.status === 'fulfilled' ? hrp.value : { match: false };
    const amlR = aml.status === 'fulfilled' ? aml.value : { alert: false, severity: undefined as string | undefined };

    // Publish completed events for the audit ledger
    void this.bus.publish(makeEvent({
      eventType: 'fds.scoring.completed', correlationId: transferRef, businessProcess: 'fraud_investigation', source: 'p2p.compliance', causationId: e.eventId,
      payload: { transactionId: transferRef, outcome: fdsR.flag ? 'declined' : 'approved', approved: !fdsR.flag, riskScore: fdsR.score, fraudFlag: fdsR.flag, reason: fdsR.reason },
      bian: { serviceDomain: 'SD-63 Fraud Evaluation', controlRecord: 'FraudEvaluationAssessment' },
    }));
    void this.bus.publish(makeEvent({
      eventType: 'hrp.screening.completed', correlationId: transferRef, businessProcess: 'fraud_investigation', source: 'p2p.compliance', causationId: e.eventId,
      payload: { transactionId: transferRef, outcome: hrpR.match ? 'declined' : 'approved', approved: !hrpR.match, reason: hrpR.match ? 'sanctions_match' : undefined },
      bian: { serviceDomain: 'SD-13 Party Reference', controlRecord: 'PartyReferenceDataDirectoryEntry' },
    }));
    void this.bus.publish(makeEvent({
      eventType: 'aml.monitoring.completed', correlationId: transferRef, businessProcess: 'fraud_investigation', source: 'p2p.compliance', causationId: e.eventId,
      payload: { transactionId: transferRef, outcome: amlR.alert ? 'alert' : 'clear', alert: amlR.alert, severity: amlR.severity },
      bian: { serviceDomain: 'SD-99 AML', controlRecord: 'SuspiciousActivityAnalysisAssessment' },
    }));

    // Open fraud case if any gate flagged
    const riskIndicators: string[] = [
      ...(fdsR.flag ? [`fds.high.risk${fdsR.reason ? ': ' + fdsR.reason : ''}`] : []),
      ...(hrpR.match ? ['hrp.sanctions.match'] : []),
      ...(amlR.alert ? [`aml.alert${amlR.severity ? ': ' + amlR.severity : ''}`] : []),
    ];

    if (riskIndicators.length > 0) {
      await this.openFraudCase(transferRef, initiatorPartyRef, riskIndicators, fdsR.score ?? 60);
    }
  }

  private async runFds(transferRef: string, amount: number, currency: string): Promise<{ flag: boolean; score: number; reason?: string }> {
    try {
      const r = await dispatchProvider(this.db, 'fraud_detection', 'fds.scoring.requested', {
        cardTransactionInstanceReference: transferRef, amount, currency, merchantName: 'P2P Transfer',
      }, { entityType: 'transaction', entityId: transferRef, processType: 'fraud_evaluation' });
      const b = r.responseBody as { riskScore?: number; recommendation?: string; fraudFlag?: boolean; reason?: string } | undefined;
      const flag = !!(b?.recommendation === 'block' || b?.recommendation === 'decline' || b?.fraudFlag);
      return { flag, score: b?.riskScore ?? 0, reason: b?.reason };
    } catch { return { flag: false, score: 0 }; }
  }

  private async runHrp(transferRef: string, partyRef: string): Promise<{ match: boolean }> {
    try {
      const r = await dispatchProvider(this.db, 'hrp_sanctions', 'hrp.screening.requested', {
        cardTransactionInstanceReference: transferRef, accountReference: partyRef,
      }, { entityType: 'transaction', entityId: transferRef, processType: 'aml_screening' });
      const b = r.responseBody as { hrpcMatch?: boolean; match?: boolean } | undefined;
      return { match: !!(b?.hrpcMatch ?? b?.match) };
    } catch { return { match: false }; }
  }

  private async runAml(transferRef: string, amount: number, accountRef: string): Promise<{ alert: boolean; severity?: string }> {
    try {
      const r = await dispatchProvider(this.db, 'aml_monitoring', 'aml.monitoring.requested', {
        cardTransactionInstanceReference: transferRef, amount, accountReference: accountRef,
      }, { entityType: 'transaction', entityId: transferRef, processType: 'aml_screening' });
      const b = r.responseBody as { requiresReview?: boolean; alertLevel?: string; alert?: boolean; severity?: string } | undefined;
      const alert = !!(b?.requiresReview || (b?.alertLevel && b.alertLevel !== 'none') || b?.alert);
      return { alert, severity: b?.severity ?? b?.alertLevel };
    } catch { return { alert: false }; }
  }

  private async openFraudCase(transferRef: string, initiatorPartyRef: string, indicators: string[], score: number): Promise<void> {
    const severity: 'low' | 'medium' | 'high' | 'critical' = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 40 ? 'medium' : 'low';

    // Look up customer agreement for the initiator
    const agreement = await this.db.collection<{ customerAgreementInstanceReference: string }>(
      'customerAgreementProcedure'
    ).findOne({ partyInstanceReference: initiatorPartyRef }, { projection: { customerAgreementInstanceReference: 1 } });
    const customerRef = agreement?.customerAgreementInstanceReference ?? initiatorPartyRef;

    // Look up transfer for snapshot
    const exec = await this.db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION)
      .findOne({ paymentExecutionInstanceReference: transferRef });
    if (!exec) return;

    // TransactionSnapshot: reuse the same shape but with P2P semantics
    const snapshot = {
      cardTransactionInstanceReference: transferRef,
      cardTransactionMaskedPanDisplay: 'P2P Transfer',
      cardTransactionMerchantName: `P2P → ${exec.resolvedPayoutAccountReference?.slice(0, 8) ?? 'unknown'}`,
      cardTransactionMerchantCategoryCode: '6012', // MCC 6012 = Financial Institution / P2P
      cardTransactionAmount: { amount: exec.grossAmount, currency: exec.currency },
      cardTransactionDateTime: exec.initiatedAt ?? exec.recordCreatedDateTime,
      cardTransactionStatus: exec.paymentExecutionStatus,
      cardTransactionChannel: 'p2p',
    };

    const fraudCase = await createFraudCase(
      this.db, transferRef, customerRef, indicators,
      severity as import('../../../shared/models/risk.model').RiskSeverity,
      snapshot as import('../../../shared/models/transaction.model').TransactionSnapshot,
      score,
    );

    // Mark the transfer execution record with the fraud case reference
    await this.db.collection(PAYMENT_EXECUTION_COLLECTION).updateOne(
      { paymentExecutionInstanceReference: transferRef },
      { $set: { fraudCaseCreated: true, fraudDiagnosisInstanceReference: fraudCase.fraudDiagnosisInstanceReference, recordUpdatedDateTime: new Date() } }
    );

    // Add P2P discriminator and the paymentExecutionInstanceReference to the fraud case
    await this.db.collection(FRAUD_DIAGNOSIS_COLLECTION).updateOne(
      { fraudDiagnosisInstanceReference: fraudCase.fraudDiagnosisInstanceReference },
      { $set: { paymentExecutionInstanceReference: transferRef, transactionKind: 'p2p', recordUpdatedDateTime: new Date() } }
    );

    // Enrich case with subsystem signals
    const signals = extractSubsystemSignals(await this.store.trail(transferRef));
    await this.db.collection(FRAUD_DIAGNOSIS_COLLECTION).updateOne(
      { fraudDiagnosisInstanceReference: fraudCase.fraudDiagnosisInstanceReference },
      { $set: { subsystemSignals: signals, recordUpdatedDateTime: new Date() } }
    );

    emitProcessEvent(this.db, {
      entityType: 'fraud_case', entityId: fraudCase.fraudDiagnosisInstanceReference,
      processType: 'fraud_evaluation', processAction: 'p2p.fraud.case.opened', processOutcome: 'pending',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: { paymentExecutionInstanceReference: transferRef, riskIndicators: indicators, severity, score },
      bianServiceDomain: 'SD-83 Fraud Diagnosis', bianControlRecordType: 'FraudDiagnosisCase',
    });
  }
}

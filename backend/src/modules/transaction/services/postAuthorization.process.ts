import { Db } from 'mongodb';
import { EventBus, DomainEvent, makeEvent, MongoEventStore } from '../../../vendors/eventbus';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { emitProcessEvent } from '../../provider/services/businessProcessEvent.service';
import { CARD_TRANSACTION_COLLECTION } from '../models/cardTransaction.model';
import { FRAUD_DIAGNOSIS_COLLECTION } from '../../fraud/models/fraudDiagnosis.model';

// Phase 2 (dev.v8 F5): post-authorization, async. AML monitoring runs after the payment is authorized
// (it never blocks the payment), and the investigation case is ENRICHED from the correlated subsystem
// signals (issuer + FDS + sanctions + AML) so an investigator sees the full picture in one place.

// §7.2 FraudCaseEnriched.subsystemSignals: one collapsed verdict per subsystem (hrp = sanctions gate).
export interface SubsystemSignals {
  issuer: { approved: boolean; responseCode: string | null } | null;
  fds: { approved: boolean; reason: string | null } | null;
  hrp: { approved: boolean; reason: string | null } | null;
  aml: { alert: boolean; severity: string | null } | null;
}

// Pure: collapse a journey's event trail into the latest verdict per subsystem. A gate verdict travels
// as `outcome` ('approved'|'declined') with the legacy `approved` boolean accepted as a fallback.
export function extractSubsystemSignals(events: DomainEvent[]): SubsystemSignals {
  const latest = (type: string) => [...events].reverse().find((e) => e.eventType === type)?.payload as Record<string, unknown> | undefined;
  const ok = (p: Record<string, unknown>) => (p.outcome ? p.outcome !== 'declined' : p.approved !== false);
  const issuer = latest('card.issuer.validation.completed');
  const fds = latest('fds.scoring.completed');
  const hrp = latest('hrp.screening.completed');
  const aml = latest('aml.monitoring.completed');
  return {
    issuer: issuer ? { approved: ok(issuer), responseCode: (issuer.responseCode as string) ?? null } : null,
    fds: fds ? { approved: ok(fds), reason: (fds.reason as string) ?? null } : null,
    hrp: hrp ? { approved: ok(hrp), reason: (hrp.reason as string) ?? null } : null,
    aml: aml ? { alert: !!aml.alert, severity: (aml.severity as string) ?? null } : null,
  };
}

export class PostAuthorizationProcess {
  private readonly store: MongoEventStore;
  constructor(private readonly db: Db, private readonly bus: EventBus) {
    this.store = new MongoEventStore(db);
  }

  register(): void {
    this.bus.subscribe('card.payment.authorization.completed', (e) => this.onAuthorized(e));
    this.bus.subscribe('aml.monitoring.completed', (e) => this.onAmlCompleted(e));
  }

  private async onAuthorized(e: DomainEvent): Promise<void> {
    const p = e.payload as { outcome?: 'authorized' | 'declined'; fraudCaseCreated?: boolean; fraudDiagnosisInstanceReference?: string };
    if (p.outcome === 'declined') return; // post-auth only runs for an authorized payment (§5.2)
    const txnId = e.correlationId;
    await this.runAmlMonitoring(txnId, e.eventId);
    if (p.fraudCaseCreated && p.fraudDiagnosisInstanceReference) {
      await this.enrichCase(txnId, p.fraudDiagnosisInstanceReference);
    }
    // A5: Debit card funding account balance (BIAN SD-88 cardAccountReference, PCI Req 3.2)
    // Uses only the UUID reference: IBAN is never read here.
    void this.decrementCardFundingBalance(txnId).catch(() => {});
  }

  // AML transaction monitoring, post-auth. May raise an alert; never blocks the (already done) payment.
  // Emits the reference-led aml.monitoring.requested (§7.2) then aml.monitoring.completed (causation).
  private async runAmlMonitoring(txnId: string, causationParent?: string): Promise<void> {
    const requested = makeEvent({
      eventType: 'aml.monitoring.requested', correlationId: txnId, businessProcess: 'fraud_investigation', source: 'psp.core', causationId: causationParent,
      payload: {}, bian: { serviceDomain: 'SD-99 AML', controlRecord: 'SuspiciousActivityAnalysisAssessment' },
    });
    void this.bus.publish(requested);
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
      eventType: 'aml.monitoring.completed', correlationId: txnId, businessProcess: 'fraud_investigation', source: 'callback.aml', causationId: requested.eventId,
      payload: { transactionId: txnId, outcome: alert ? 'alert' : 'clear', alert, severity }, bian: { serviceDomain: 'SD-99 AML', controlRecord: 'SuspiciousActivityAnalysisAssessment' },
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
      processAction: 'fraud.case.enriched', processOutcome: 'pending',
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

  // A5: After a card event, update the PSP internal ledger balance for the funding payout account.
  // v17: DEBIT holds now happen atomically in the funds-check GATE (providerGroups.onFunds) BEFORE the
  // payment is authorized, so this post-auth step no longer holds for purchases (that would double-debit).
  // It only handles the REFUND credit path (return funds to the cardholder's available balance).
  // Uses only UUID references: IBAN is never accessed (PCI DSS Req 3.2).
  private async decrementCardFundingBalance(txnId: string): Promise<void> {
    const txn = await this.db.collection<{
      cardTransactionAmount?: { amount: number; currency: string };
      paymentCardInstanceReference?: string;
      cardTransactionStatus?: string;
      cardTransactionType?: string;
    }>(CARD_TRANSACTION_COLLECTION).findOne(
      { cardTransactionInstanceReference: txnId },
      { projection: { cardTransactionAmount: 1, paymentCardInstanceReference: 1, cardTransactionStatus: 1, cardTransactionType: 1 } }
    );
    if (txn?.cardTransactionType !== 'refund') return; // debits are held by the funds gate, not here
    if (!txn?.paymentCardInstanceReference || !txn?.cardTransactionAmount) return;
    const { creditDirect } = await import('../../gateway/services/payoutAccountBalance.service');
    const { PAYMENT_CARD_COLLECTION } = await import('../../customer/models/paymentCard.model');
    const { resolveAndConvert } = await import('../../../providers/currency-exchange/services/currencyExchange.service');
    const card = await this.db.collection<{ fundingPayoutAccountInstanceReference?: string }>(PAYMENT_CARD_COLLECTION)
      .findOne({ paymentCardInstanceReference: txn.paymentCardInstanceReference }, { projection: { fundingPayoutAccountInstanceReference: 1 } });
    if (!card?.fundingPayoutAccountInstanceReference) return;
    const accountRef = card.fundingPayoutAccountInstanceReference;
    // Refund: return funds to cardholder available balance (BIAN SD-88 credit), in account currency (FX).
    const { PAYOUT_ACCOUNT_COLLECTION } = await import('../../gateway/models/payoutAccount.model');
    const account = await this.db.collection<{ payoutAccountCurrency?: string }>(PAYOUT_ACCOUNT_COLLECTION)
      .findOne({ payoutAccountInstanceReference: accountRef }, { projection: { payoutAccountCurrency: 1 } });
    let amount = txn.cardTransactionAmount.amount;
    if (account?.payoutAccountCurrency && account.payoutAccountCurrency !== txn.cardTransactionAmount.currency) {
      try { amount = (await resolveAndConvert(this.db, amount, txn.cardTransactionAmount.currency, account.payoutAccountCurrency)).amount; } catch { /* keep original on FX error */ }
    }
    await creditDirect(this.db, accountRef, amount);
  }
}

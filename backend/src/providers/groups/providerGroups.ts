import { Db } from 'mongodb';
import { EventBus, DomainEvent, makeEvent } from '../../vendors/eventbus';
import { dispatchProvider } from '../../modules/provider/services/integrationDispatch.service';
import { getChdCrypto } from '../../vendors/encryption/chdCrypto';
import { recordPendingCorrelation } from '../../modules/provider/services/pendingCorrelation.service';
import { publishIssuerValidationCompleted } from '../../modules/transaction/services/cardTransaction.service';

// Provider Group reactors: each subscribes to a provider category's `*.requested` event, performs the
// outbound call (the only place dispatchProvider runs for these flows), and publishes the matching
// `*.completed`. This makes the payment-authorization gates bus-driven — the orchestrator only emits
// requests; the actual provider call is a reaction to the bus. Card data (`chd`) is decrypted here,
// just-in-time, only by the card-issuer reactor; plaintext never returns to the bus.

const ISSUER_AAD_EVENT = 'card.issuer.validation.requested';

export class ProviderGroups {
  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  register(): void {
    this.bus.subscribe('card.issuer.validation.requested', (e) => this.onIssuer(e));
    this.bus.subscribe('fds.scoring.requested', (e) => this.onFds(e));
    this.bus.subscribe('hrp.screening.requested', (e) => this.onHrp(e));
  }

  // Real-time fraud scoring. Fail-open: only an explicit block/decline declines.
  private async onFds(e: DomainEvent): Promise<void> {
    const p = e.payload as Record<string, unknown>;
    let approved = true;
    let reason: string | undefined;
    let verdict: { riskScore?: number; recommendation?: string; fraudFlag?: boolean; rulesFired?: string[] } | undefined;
    try {
      const r = await dispatchProvider(this.db, 'fraud_detection', 'fds.scoring.requested', {
        cardTransactionInstanceReference: e.correlationId, amount: p.amount, currency: p.currency,
        merchantName: p.merchantName, merchantCategoryCode: p.merchantCategoryCode,
      }, { entityType: 'transaction', entityId: e.correlationId, processType: 'fraud_evaluation' });
      verdict = r.responseBody as typeof verdict;
      if (verdict?.recommendation === 'block' || verdict?.recommendation === 'decline') { approved = false; reason = 'fraud_block'; }
    } catch { /* fail-open */ }
    void this.bus.publish(makeEvent({
      eventType: 'fds.scoring.completed', correlationId: e.correlationId, businessProcess: 'card_payment', source: 'callback.fds', causationId: e.eventId,
      payload: { transactionId: e.correlationId, outcome: approved ? 'approved' : 'declined', approved, reason, riskScore: verdict?.riskScore, recommendation: verdict?.recommendation, fraudFlag: verdict?.fraudFlag, rulesFired: verdict?.rulesFired },
      bian: { serviceDomain: 'SD-63 Fraud Evaluation', controlRecord: 'FraudEvaluationAssessment' },
    }));
  }

  // Sanctions/HRP screening. Fail-open on transport error; a match is a hard decline.
  private async onHrp(e: DomainEvent): Promise<void> {
    const p = e.payload as Record<string, unknown>;
    let approved = true;
    let reason: string | undefined;
    try {
      const r = await dispatchProvider(this.db, 'hrp_sanctions', 'hrp.screening.requested', {
        cardTransactionInstanceReference: e.correlationId, accountReference: p.accountReference, merchantName: p.merchantName,
      }, { entityType: 'transaction', entityId: e.correlationId, processType: 'aml_screening' });
      const b = r.responseBody as { hrpcMatch?: boolean; match?: boolean } | undefined;
      if (b && (b.hrpcMatch ?? b.match)) { approved = false; reason = 'sanctions_match'; }
    } catch { /* fail-open */ }
    void this.bus.publish(makeEvent({
      eventType: 'hrp.screening.completed', correlationId: e.correlationId, businessProcess: 'card_payment', source: 'callback.hrp', causationId: e.eventId,
      payload: { transactionId: e.correlationId, outcome: approved ? 'approved' : 'declined', approved, reason },
      bian: { serviceDomain: 'SD-13 Party Reference', controlRecord: 'PartyReferenceDataDirectoryEntry' },
    }));
  }

  // Card-issuer validation. Decrypts the `chd` carrier just-in-time for the wire; plaintext is never
  // re-published or logged. Fail-safe to approve on transport failure (only an explicit decline blocks).
  private async onIssuer(e: DomainEvent): Promise<void> {
    const p = e.payload as { cardToken?: string; maskedPan?: string; cardNetwork?: string; chd?: string; cvvExpected?: boolean };
    const txnId = e.correlationId;

    // Restore the journey envelope for a would-be async issuer callback (the sync built-in path
    // completes inline below).
    recordPendingCorrelation({ ref: txnId, correlationId: txnId, causationId: e.eventId, businessProcess: 'card_payment', eventType: 'card.issuer.validation.completed' });

    let cardData: { cardNumber?: string; cvv?: string; expiry?: string } = {};
    if (p.chd) {
      try { cardData = await getChdCrypto().decrypt(p.chd, { correlationId: txnId, eventType: ISSUER_AAD_EVENT }); }
      catch { /* tamper / AAD mismatch — send no CHD on the wire */ }
    }

    let decision: { actionConfirmed?: boolean; responseCode?: string; decisionReason?: string } | undefined;
    try {
      const r = await dispatchProvider(this.db, 'card_issuer', 'card.issuer.validation.requested', {
        cardToken: p.cardToken, maskedPan: p.maskedPan, cardTransactionInstanceReference: txnId,
        ...(p.cardNetwork ? { network: p.cardNetwork } : {}),
        ...(cardData.cardNumber ? { cardNumber: cardData.cardNumber } : {}),
        ...(cardData.cvv ? { cvv: cardData.cvv } : {}),
        ...(cardData.expiry ? { expiry: cardData.expiry } : {}),
        ...(p.cvvExpected ? { cvvExpected: true } : {}),
      }, { entityType: 'transaction', entityId: txnId, processType: 'payment_processing' });
      decision = r.responseBody as typeof decision;
    } catch { /* fail-safe to approve */ }

    publishIssuerValidationCompleted(txnId, {
      approved: decision?.actionConfirmed !== false,
      responseCode: decision?.responseCode,
      decisionReason: decision?.decisionReason,
    }, e.eventId);
  }
}

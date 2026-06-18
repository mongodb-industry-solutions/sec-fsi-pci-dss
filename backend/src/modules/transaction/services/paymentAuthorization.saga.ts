import { Db } from 'mongodb';
import { EventBus, DomainEvent, makeEvent } from '../../../vendors/eventbus';
import { completeAuthorized, declineTransaction } from './cardTransaction.service';

// Real-PSP Phase-1 gate (dev.v8 F4): card-payment authorization waits on card-issuer + fraud scoring
// (FDS) + sanctions screening (HRP), each arriving as its own bus event. The saga aggregates the
// verdicts per journey: a hard decline (any gate) declines immediately; otherwise once all gates are
// in it authorizes. Then it publishes the single terminal card.payment.authorization.completed whose
// payload.outcome carries authorized|declined (§6.1). Aggregation is in-memory, matching the
// in-process bus (a broker migration moves both together).

const GATE_EVENT: Record<string, string> = {
  'card.issuer.validation.completed': 'card.issuer',
  'fds.scoring.completed': 'fds',
  'hrp.screening.completed': 'hrp',
};
const DEFAULT_GATES = ['card.issuer', 'fds', 'hrp'];

interface GateVerdict { approved: boolean; responseCode?: string; reason?: string; riskScore?: number; recommendation?: 'approve' | 'review' | 'decline'; fraudFlag?: boolean; rulesFired?: string[] }
interface JourneyState { expected: Set<string>; verdicts: Map<string, GateVerdict>; decided: boolean }

export class PaymentAuthorizationSaga {
  private readonly journeys = new Map<string, JourneyState>();

  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  register(): void {
    this.bus.subscribe('card.payment.authorization.requested', (e) => this.begin(e));
    for (const type of Object.keys(GATE_EVENT)) {
      this.bus.subscribe(type, (e) => this.onGate(GATE_EVENT[type], e));
    }
  }

  private begin(e: DomainEvent): void {
    const expected = (e.payload as { gatesExpected?: string[] }).gatesExpected ?? DEFAULT_GATES;
    if (!this.journeys.has(e.correlationId)) {
      this.journeys.set(e.correlationId, { expected: new Set(expected), verdicts: new Map(), decided: false });
    }
  }

  private async onGate(gate: string, e: DomainEvent): Promise<void> {
    const txnId = e.correlationId;
    // Fallback if the gate result beats the `requested` event (in-process race): assume the default set.
    let st = this.journeys.get(txnId);
    if (!st) { st = { expected: new Set(DEFAULT_GATES), verdicts: new Map(), decided: false }; this.journeys.set(txnId, st); }
    if (st.decided) return;

    // Gate verdict travels in the *.completed payload. Accept the §7 `outcome` enum
    // ('approved'|'declined') and the legacy `approved` boolean for forward/back compatibility.
    const p = e.payload as { outcome?: 'approved' | 'declined'; approved?: boolean; responseCode?: string; decisionReason?: string; reason?: string; riskScore?: number; recommendation?: 'approve' | 'review' | 'decline'; fraudFlag?: boolean; rulesFired?: string[] };
    const approved = p.outcome ? p.outcome !== 'declined' : p.approved !== false;
    st.verdicts.set(gate, { approved, responseCode: p.responseCode, reason: p.decisionReason ?? p.reason, riskScore: p.riskScore, recommendation: p.recommendation, fraudFlag: p.fraudFlag, rulesFired: p.rulesFired });

    const declinedEntry = [...st.verdicts.entries()].find(([, v]) => !v.approved);
    const allIn = [...st.expected].every((g) => st!.verdicts.has(g));
    if (!declinedEntry && !allIn) return;

    st.decided = true;
    // Keep the decided journey briefly so late/duplicate gate events are ignored (not re-decided),
    // then free memory.
    setTimeout(() => this.journeys.delete(txnId), 60_000).unref();
    const bian = { serviceDomain: 'SD-254 Card Transaction', controlRecord: 'CardTransactionRecord' };

    // One closing event per journey (§6.1): outcome lives in the payload, not in the event name.
    if (declinedEntry) {
      const [declinedBy, verdict] = declinedEntry;
      await declineTransaction(this.db, txnId, verdict.reason ?? 'declined', verdict.responseCode ?? 'declined');
      void this.bus.publish(makeEvent({
        eventType: 'card.payment.authorization.completed', correlationId: txnId, businessProcess: 'card_payment',
        causationId: e.eventId, source: 'saga.payment-authorization',
        payload: { outcome: 'declined', decisionReason: verdict.reason, responseCode: verdict.responseCode, declinedBy, fraudCaseCreated: false }, bian,
      }));
    } else {
      // Hand the FDS gate verdict to completion so the fraud case is congruent with the gate result.
      const fdsV = st.verdicts.get('fds');
      const fdsVerdict = fdsV?.recommendation
        ? { riskScore: fdsV.riskScore ?? 0, recommendation: fdsV.recommendation, fraudFlag: !!fdsV.fraudFlag, rulesFired: fdsV.rulesFired ?? [] }
        : undefined;
      const outcome = await completeAuthorized(this.db, txnId, fdsVerdict);
      void this.bus.publish(makeEvent({
        eventType: 'card.payment.authorization.completed', correlationId: txnId, businessProcess: 'card_payment',
        causationId: e.eventId, source: 'saga.payment-authorization',
        payload: { outcome: 'authorized', ...outcome }, bian,
      }));
    }
  }
}

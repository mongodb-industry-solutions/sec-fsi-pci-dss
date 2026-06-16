import { Db } from 'mongodb';
import { EventBus, DomainEvent, makeEvent } from '../../../vendors/eventbus';
import { completeAuthorized, declineTransaction } from './cardTransaction.service';

// Real-PSP Phase-1 gate (dev.v8 F4): card-payment authorization waits on card-issuer + fraud scoring
// (FDS) + sanctions screening (HRP), each arriving as its own bus event. The saga aggregates the
// verdicts per journey: a hard decline (any gate) declines immediately; otherwise once all gates are
// in it authorizes. Then it publishes the terminal payment.authorized / payment.declined.
// Aggregation is in-memory, matching the in-process bus (a broker migration moves both together).

const GATE_EVENT: Record<string, string> = {
  'cardissuer.validation.completed': 'cardissuer',
  'fraud.scoring.completed': 'fds',
  'sanctions.screening.completed': 'sanctions',
};
const DEFAULT_GATES = ['cardissuer', 'fds', 'sanctions'];

interface GateVerdict { approved: boolean; responseCode?: string; reason?: string }
interface JourneyState { expected: Set<string>; verdicts: Map<string, GateVerdict>; decided: boolean }

export class PaymentAuthorizationSaga {
  private readonly journeys = new Map<string, JourneyState>();

  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  register(): void {
    this.bus.subscribe('payment.authorization.requested', (e) => this.begin(e));
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

    const p = e.payload as { approved?: boolean; responseCode?: string; decisionReason?: string; reason?: string };
    st.verdicts.set(gate, { approved: p.approved !== false, responseCode: p.responseCode, reason: p.decisionReason ?? p.reason });

    const declined = [...st.verdicts.values()].find((v) => !v.approved);
    const allIn = [...st.expected].every((g) => st!.verdicts.has(g));
    if (!declined && !allIn) return;

    st.decided = true;
    // Keep the decided journey briefly so late/duplicate gate events are ignored (not re-decided),
    // then free memory.
    setTimeout(() => this.journeys.delete(txnId), 60_000).unref();
    const bian = { serviceDomain: 'SD-254 Card Transaction', controlRecord: 'CardTransactionRecord' };

    if (declined) {
      await declineTransaction(this.db, txnId, declined.reason ?? 'declined', declined.responseCode ?? 'declined');
      void this.bus.publish(makeEvent({
        eventType: 'payment.declined', correlationId: txnId, businessProcess: 'card_payment',
        causationId: e.eventId, source: 'saga.payment-authorization',
        payload: { transactionId: txnId, decisionReason: declined.reason, responseCode: declined.responseCode }, bian,
      }));
    } else {
      const outcome = await completeAuthorized(this.db, txnId);
      void this.bus.publish(makeEvent({
        eventType: 'payment.authorized', correlationId: txnId, businessProcess: 'card_payment',
        causationId: e.eventId, source: 'saga.payment-authorization',
        payload: { transactionId: txnId, ...outcome }, bian,
      }));
    }
  }
}

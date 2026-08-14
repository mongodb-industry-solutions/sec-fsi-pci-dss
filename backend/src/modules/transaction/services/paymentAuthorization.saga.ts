import { Db } from 'mongodb';
import { EventBus, DomainEvent, makeEvent } from '../../../vendors/eventbus';
import { completeAuthorized, declineTransaction } from './cardTransaction.service';
import { releaseCardHold } from '../../gateway/services/payoutAccountBalance.service';

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
  'funds.check.completed': 'funds',
};
const DEFAULT_GATES = ['card.issuer', 'fds', 'hrp', 'funds'];

interface GateVerdict { approved: boolean; responseCode?: string; reason?: string; riskScore?: number; recommendation?: 'approve' | 'review' | 'decline'; fraudFlag?: boolean; rulesFired?: string[]; sanctionsMatch?: boolean }
// A sanctions match is scored as a high-risk indicator so the case severity reflects it.
const SANCTIONS_RISK_SCORE = 90;
// fundsHold: the atomic hold the funds gate made (available -> pending). Released as a compensation if
// the journey is later declined by any gate (or if the hold lands after an earlier decline: race).
interface JourneyState {
  expected: Set<string>;
  verdicts: Map<string, GateVerdict>;
  decided: boolean;
  decisionOutcome?: 'authorized' | 'declined';
  fundsHold?: { accountRef: string; amount: number };
  holdReleased?: boolean;
}

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
    // Only the authoritative gate verdict drives the saga. Audit-ledger projections (emit*/compliance
    // events) can share a gate's eventType (e.g. the card-issuer module's own compliance event is also
    // `card.issuer.validation.completed`) but carry a `ledgerKind` and use a ledger outcome ('rejected')
    //: ignore them so they never masquerade as a gate approval.
    if ((e.payload as { ledgerKind?: string }).ledgerKind) return;
    // Fallback if the gate result beats the `requested` event (in-process race): assume the default set.
    let st = this.journeys.get(txnId);
    if (!st) { st = { expected: new Set(DEFAULT_GATES), verdicts: new Map(), decided: false }; this.journeys.set(txnId, st); }

    // Gate verdict travels in the *.completed payload. Accept the §7 `outcome` enum
    // ('approved'|'declined') and the legacy `approved` boolean for forward/back compatibility.
    const p = e.payload as { outcome?: 'approved' | 'declined'; approved?: boolean; responseCode?: string; decisionReason?: string; reason?: string; riskScore?: number; recommendation?: 'approve' | 'review' | 'decline'; fraudFlag?: boolean; rulesFired?: string[]; sanctionsMatch?: boolean; held?: number; fundingPayoutAccountReference?: string };
    const approved = p.outcome ? p.outcome !== 'declined' : p.approved !== false;

    // Record any hold the funds gate made, even after the journey is decided (ordering race): a gate
    // may decline BEFORE the funds gate runs, so the hold can land on an already-declined journey.
    if (gate === 'funds' && p.held && p.fundingPayoutAccountReference) {
      st.fundsHold = { accountRef: p.fundingPayoutAccountReference, amount: p.held };
      if (st.decided && st.decisionOutcome === 'declined') { await this.releaseHold(st); }
    }

    if (st.decided) return;
    st.verdicts.set(gate, { approved, responseCode: p.responseCode, reason: p.decisionReason ?? p.reason, riskScore: p.riskScore, recommendation: p.recommendation, fraudFlag: p.fraudFlag, rulesFired: p.rulesFired, sanctionsMatch: p.sanctionsMatch });

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
      st.decisionOutcome = 'declined';
      // Compensation: release any funds hold already made by the funds gate before this decline.
      await this.releaseHold(st);
      await declineTransaction(this.db, txnId, verdict.reason ?? 'declined', verdict.responseCode ?? 'declined');
      void this.bus.publish(makeEvent({
        eventType: 'card.payment.authorization.completed', correlationId: txnId, businessProcess: 'card_payment',
        causationId: e.eventId, source: 'saga.payment-authorization',
        payload: { outcome: 'declined', decisionReason: verdict.reason, responseCode: verdict.responseCode, declinedBy, fraudCaseCreated: false }, bian,
      }));
    } else {
      // Hand the risk verdict to completion so the fraud case is congruent with the gate results. A
      // sanctions match is merged in as a risk indicator: it holds the payment and opens the case
      // instead of declining, so it is never accepted without an explicit L1/L2 resolution.
      const fdsV = st.verdicts.get('fds');
      let fdsVerdict = fdsV?.recommendation
        ? { riskScore: fdsV.riskScore ?? 0, recommendation: fdsV.recommendation, fraudFlag: !!fdsV.fraudFlag, rulesFired: fdsV.rulesFired ?? [] }
        : undefined;
      if (st.verdicts.get('hrp')?.sanctionsMatch) {
        fdsVerdict = {
          riskScore: Math.max(fdsVerdict?.riskScore ?? 0, SANCTIONS_RISK_SCORE),
          recommendation: 'review',
          fraudFlag: true,
          rulesFired: [...(fdsVerdict?.rulesFired ?? []), 'sanctions_match'],
        };
      }
      st.decisionOutcome = 'authorized';
      const outcome = await completeAuthorized(this.db, txnId, fdsVerdict);
      void this.bus.publish(makeEvent({
        eventType: 'card.payment.authorization.completed', correlationId: txnId, businessProcess: 'card_payment',
        causationId: e.eventId, source: 'saga.payment-authorization',
        payload: { outcome: 'authorized', ...outcome }, bian,
      }));
    }
  }

  // Release the funds-gate hold (pending -> available) exactly once. Idempotent per journey via the
  // holdReleased flag: called both at decline time and on a late-arriving hold after an earlier decline.
  private async releaseHold(st: JourneyState): Promise<void> {
    if (!st.fundsHold || st.holdReleased) return;
    st.holdReleased = true;
    try { await releaseCardHold(this.db, st.fundsHold.accountRef, st.fundsHold.amount); }
    catch (err) { console.error('[saga] releaseCardHold failed:', err); }
  }
}

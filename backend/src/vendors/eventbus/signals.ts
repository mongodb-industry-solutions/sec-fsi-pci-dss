import { getEventBus, makeEvent } from './index';

// Ephemeral SSE wake-up signals (case updates, per-party notifications) published on the SINGLE
// EventBus, marked `transient` so they are delivered but NOT persisted. No CHD, only opaque refs
// (caseId, questionId, transactionId, partyRef). Best-effort: no-op if the bus is not initialized.
function bus() { try { return getEventBus(); } catch { return null; } }

export interface CaseStreamEvent {
  caseId: string;
  kind: 'question.created' | 'question.answered' | 'case.updated';
  questionId?: string;
  transactionId?: string;
  at: string;
}

export function publishCaseEvent(event: CaseStreamEvent): void {
  void bus()?.publish(makeEvent({
    eventType: `case.${event.kind}`,
    correlationId: event.caseId,
    businessProcess: 'fraud_investigation',
    source: 'signal.case',
    payload: { questionId: event.questionId, transactionId: event.transactionId },
    transient: true,
  }));
}

export function subscribeCaseEvents(caseId: string, listener: (event: CaseStreamEvent) => void): () => void {
  const b = bus();
  if (!b) return () => {};
  const sub = b.subscribe('case.*', (e) => {
    const p = e.payload as { questionId?: string; transactionId?: string };
    listener({ caseId, kind: e.eventType.slice('case.'.length) as CaseStreamEvent['kind'], questionId: p.questionId, transactionId: p.transactionId, at: e.occurredAt });
  }, { correlationId: caseId });
  return () => sub.unsubscribe();
}

export function publishPartyNotification(partyRef: string | undefined): void {
  if (!partyRef) return;
  void bus()?.publish(makeEvent({
    eventType: 'party.notification',
    correlationId: `party:${partyRef}`,
    businessProcess: 'system',
    source: 'signal.party',
    payload: {},
    transient: true,
  }));
}

export function subscribePartyNotifications(partyRef: string, listener: () => void): () => void {
  const b = bus();
  if (!b) return () => {};
  const sub = b.subscribe('party.notification', () => listener(), { correlationId: `party:${partyRef}` });
  return () => sub.unsubscribe();
}

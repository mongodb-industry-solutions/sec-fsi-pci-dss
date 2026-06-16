import { EventBusInProcess } from './EventBusInProcess';
import { makeEvent } from './index';

// Ephemeral SSE wake-up signals (case updates, per-party notifications). Reuses the bus adapter
// WITHOUT a store: these are transient signals, not persisted domain facts. No CHD is ever published,
// only opaque references (caseId, questionId, transactionId, partyRef). PCI DSS Req 3/10.
const signals = new EventBusInProcess();

export interface CaseStreamEvent {
  caseId: string;
  kind: 'question.created' | 'question.answered' | 'case.updated';
  questionId?: string;
  transactionId?: string;
  at: string;
}

export function publishCaseEvent(event: CaseStreamEvent): void {
  void signals.publish(makeEvent({
    eventType: `case.${event.kind}`,
    correlationId: event.caseId,
    businessProcess: 'fraud_investigation',
    source: 'signal.case',
    payload: { questionId: event.questionId, transactionId: event.transactionId },
  }));
}

export function subscribeCaseEvents(caseId: string, listener: (event: CaseStreamEvent) => void): () => void {
  const sub = signals.subscribe('case.*', (e) => {
    const p = e.payload as { questionId?: string; transactionId?: string };
    listener({ caseId, kind: e.eventType.slice('case.'.length) as CaseStreamEvent['kind'], questionId: p.questionId, transactionId: p.transactionId, at: e.occurredAt });
  }, { correlationId: caseId });
  return () => sub.unsubscribe();
}

export function publishPartyNotification(partyRef: string | undefined): void {
  if (!partyRef) return;
  void signals.publish(makeEvent({
    eventType: 'party.notification',
    correlationId: `party:${partyRef}`,
    businessProcess: 'system',
    source: 'signal.party',
    payload: {},
  }));
}

export function subscribePartyNotifications(partyRef: string, listener: () => void): () => void {
  const sub = signals.subscribe('party.notification', () => listener(), { correlationId: `party:${partyRef}` });
  return () => sub.unsubscribe();
}

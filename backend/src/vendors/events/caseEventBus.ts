import { EventEmitter } from 'events';

// In-process pub/sub for live case updates (SSE). When a customer answers a question, the
// investigation page (L2) receives an event and refreshes without a manual reload.
//
// NOTE: single-process only (demo). For a multi-instance deployment this would be backed by a
// shared broker (e.g. Redis pub/sub or MongoDB change streams). No CHD is ever published here,
// only opaque references (caseId, questionId, transactionId) and an event kind (PCI DSS Req 3/10).
const bus = new EventEmitter();
bus.setMaxListeners(0); // many concurrent SSE subscribers across cases

export interface CaseStreamEvent {
  caseId: string;
  kind: 'question.created' | 'question.answered' | 'case.updated';
  questionId?: string;
  transactionId?: string;
  at: string; // ISO timestamp
}

const channel = (caseId: string) => `case:${caseId}`;
const partyChannel = (partyRef: string) => `party:${partyRef}`;

export function publishCaseEvent(event: CaseStreamEvent): void {
  bus.emit(channel(event.caseId), event);
}

// Subscribe to a single case's events; returns an unsubscribe function.
export function subscribeCaseEvents(caseId: string, listener: (event: CaseStreamEvent) => void): () => void {
  const ch = channel(caseId);
  bus.on(ch, listener);
  return () => { bus.off(ch, listener); };
}

// Per-party notification signal: fired when the party's notification set changes (a question is
// raised to them, or one they had pending is answered). Carries no payload (the client refetches the
// scoped list), keeps CHD/PII out of the stream entirely (PCI DSS Req 3/7).
export function publishPartyNotification(partyRef: string | undefined): void {
  if (partyRef) bus.emit(partyChannel(partyRef), { at: new Date().toISOString() });
}

export function subscribePartyNotifications(partyRef: string, listener: () => void): () => void {
  const ch = partyChannel(partyRef);
  bus.on(ch, listener);
  return () => { bus.off(ch, listener); };
}

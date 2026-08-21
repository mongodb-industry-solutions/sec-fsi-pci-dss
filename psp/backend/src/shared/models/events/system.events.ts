// Bus payload contract for the `system` process (architecture §7.6).
// Ephemeral fan-out (transient, not persisted). correlationId = recipient partyReference.

/**
 * @event    party.notification
 * @producer psp.core  @consumer Frontend SSE (bell + sidebar counter)
 */
export interface PartyNotification {
  kind: 'case' | 'transaction' | 'system';
  title: string;
  body?: string;
  refId?: string;                           // caseRef | transactionId the bell links to
}

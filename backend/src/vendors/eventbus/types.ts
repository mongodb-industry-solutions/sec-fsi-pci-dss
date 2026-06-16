// Event-Driven Architecture core types (dev.v8). The DomainEvent envelope is the STABLE contract
// every publisher/consumer depends on; the transport (this in-process bus, or a future Kafka /
// RabbitMQ adapter) can change without touching it. No CHD ever travels in payload (sanitized on
// publish) — PCI DSS Req 3.2 / Req 10.

// TYPE of business process an event belongs to. Used to GROUP events for audit/investigation.
export type BusinessProcess =
  | 'card_payment'
  | 'fraud_investigation'
  | 'card_management'
  | 'customer_onboarding'
  | 'merchant_onboarding'
  | 'provider_integration'
  | 'system';

export interface DomainEvent<T = Record<string, unknown>> {
  /** uuid v4 — idempotency key (a consumer/store may dedupe on this). */
  eventId: string;
  /** Dotted, module/domain-prefixed, e.g. 'payment.authorization.requested'. */
  eventType: string;
  /** ISO-8601 timestamp. */
  occurredAt: string;
  /** The business-process INSTANCE id (one journey). All events of a journey share it. */
  correlationId: string;
  /** The eventId that caused this event (cause -> effect chain). */
  causationId?: string;
  /** The CLASS of process, used to group events. */
  businessProcess: BusinessProcess;
  /** Ordering/partition key for a future partitioned broker (defaults to correlationId). */
  partitionKey?: string;
  /** Emitting component, e.g. 'psp.core', 'saga.payment-authorization', 'module.card-issuer'. */
  source: string;
  /** Who triggered it, when applicable. */
  actor?: { partyRef?: string | null; role?: string | null };
  /** BIAN mapping for the event. */
  bian?: { serviceDomain: string; controlRecord: string };
  /** Sanitized domain data — NEVER cardholder data (stripped on publish). */
  payload: T;
  /** Envelope schema version. */
  schemaVersion: number;
}

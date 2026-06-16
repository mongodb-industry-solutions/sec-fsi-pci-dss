// EventBus PORT — the stable interface the whole system depends on. The current implementation is
// in-process (InProcessEventBus); a future KafkaEventBus / RabbitEventBus implements THIS SAME
// interface so publishers and consumers never change (dev.v8 D1).
import { DomainEvent } from './types';

export type EventHandler = (event: DomainEvent) => Promise<void> | void;

export interface Subscription {
  unsubscribe(): void;
}

export interface EventBus {
  /** Persist (sanitized) then deliver to matching subscribers. Idempotent by eventId. */
  publish<T>(event: DomainEvent<T>): Promise<void>;
  /**
   * Subscribe to events whose eventType matches a pattern. '*' matches everything; a pattern with
   * '*' (e.g. 'payment.*') matches any type with that prefix/segment. `group` reserves consumer-group
   * semantics for a future partitioned broker (ignored in-process).
   */
  subscribe(pattern: string | string[], handler: EventHandler, opts?: { group?: string }): Subscription;
  start(): Promise<void>;
  stop(): Promise<void>;
}

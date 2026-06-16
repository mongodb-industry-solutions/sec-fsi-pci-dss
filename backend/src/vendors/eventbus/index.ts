// EventBus vendor entry point. The app initializes one bus at startup (initEventBus) and the rest of
// the system depends only on getEventBus() -> the EventBus port. Swapping the adapter (Kafka/Rabbit)
// happens HERE only; no consumer changes (dev.v8 D1).
import { Db } from 'mongodb';
import { EventBus } from './EventBus';
import { InProcessEventBus } from './InProcessEventBus';
import { MongoEventStore, EventStore } from './EventStore';
import { v4 as uuidv4 } from 'uuid';
import { DomainEvent, BusinessProcess } from './types';

let instance: EventBus | null = null;

export function initEventBus(db: Db, store?: EventStore): EventBus {
  instance = new InProcessEventBus(store ?? new MongoEventStore(db));
  return instance;
}

export function getEventBus(): EventBus {
  if (!instance) throw new Error('EventBus not initialized; call initEventBus(db) at startup');
  return instance;
}

// Test/advanced seam: inject a specific bus implementation.
export function setEventBus(bus: EventBus): void { instance = bus; }

// Helper to build a well-formed DomainEvent with sane defaults (partitionKey defaults to
// correlationId; eventId/occurredAt auto-filled). Keeps publishers terse and consistent.
export function makeEvent<T>(input: {
  eventType: string;
  correlationId: string;
  businessProcess: BusinessProcess;
  payload: T;
  causationId?: string;
  source?: string;
  partitionKey?: string;
  actor?: DomainEvent['actor'];
  bian?: DomainEvent['bian'];
}): DomainEvent<T> {
  return {
    eventId: uuidv4(),
    eventType: input.eventType,
    occurredAt: new Date().toISOString(),
    correlationId: input.correlationId,
    causationId: input.causationId,
    businessProcess: input.businessProcess,
    partitionKey: input.partitionKey ?? input.correlationId,
    source: input.source ?? 'psp.core',
    actor: input.actor,
    bian: input.bian,
    payload: input.payload,
    schemaVersion: 1,
  };
}

export * from './types';
export * from './EventBus';
export { MongoEventStore, DOMAIN_EVENT_COLLECTION } from './EventStore';
export type { EventStore } from './EventStore';

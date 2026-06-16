// EventBus vendor entry point. App calls initEventBus at startup; everything else uses getEventBus().
// Swapping the adapter (Kafka/Rabbit) happens here only.
import { Db } from 'mongodb';
import { EventBus } from './EventBus';
import { EventBusInProcess } from './EventBusInProcess';
import { MongoEventStore, EventStore } from './EventStore';
import { v4 as uuidv4 } from 'uuid';
import { DomainEvent, BusinessProcess } from './types';

let instance: EventBus | null = null;

export function initEventBus(db: Db, store?: EventStore): EventBus {
  instance = new EventBusInProcess(store ?? new MongoEventStore(db));
  return instance;
}

export function getEventBus(): EventBus {
  if (!instance) throw new Error('EventBus not initialized; call initEventBus(db) at startup');
  return instance;
}

export function setEventBus(bus: EventBus): void { instance = bus; }

// Builds a DomainEvent with defaults (eventId/occurredAt auto-filled; partitionKey = correlationId).
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
export * from './signals';
export { MongoEventStore, DOMAIN_EVENT_COLLECTION } from './EventStore';
export type { EventStore } from './EventStore';

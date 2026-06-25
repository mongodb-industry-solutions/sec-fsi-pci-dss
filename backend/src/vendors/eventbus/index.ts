// EventBus vendor entry point. App calls initEventBus at startup; everything else uses getEventBus().
// Swapping the adapter (Kafka/Rabbit) happens here only.
import { Db } from 'mongodb';
import { EventBus } from './EventBus';
import { EventBusInProcess } from './EventBusInProcess';
import { EventBusKafka } from './EventBusKafka';
import { EventBusRabbit } from './EventBusRabbit';
import { MongoEventStore, EventStore } from './EventStore';
import { v4 as uuidv4 } from 'uuid';
import { DomainEvent, BusinessProcess } from './types';

let instance: EventBus | null = null;

// The bus engine is chosen by configuration (Strategy pattern): switching engines needs no
// publisher/consumer code change, only this selection. Every engine implements the same EventBus port.
export type EventBusEngine = 'in-process' | 'kafka' | 'rabbitmq';

export function resolveEventBusEngine(): EventBusEngine {
  return (process.env.PSP_EVENT_BUS_ENGINE ?? 'in-process') as EventBusEngine;
}

export function initEventBus(db: Db, store?: EventStore): EventBus {
  const engine = resolveEventBusEngine();
  const eventStore = store ?? new MongoEventStore(db);
  const topic = `${process.env.PSP_EVENT_BUS_TOPIC_PREFIX ?? 'pci.psp'}.domain-events`;

  if (engine === 'kafka') {
    instance = new EventBusKafka({ brokers: parseList(process.env.KAFKA_BROKERS), clientId: process.env.KAFKA_CLIENT_ID ?? 'pci-psp', ssl: process.env.KAFKA_SSL === 'true', sasl: buildKafkaSasl(), topic }, eventStore);
    return instance;
  }
  if (engine === 'rabbitmq') {
    instance = new EventBusRabbit({ url: process.env.RABBITMQ_URL ?? 'amqp://localhost', exchange: topic, topic }, eventStore);
    return instance;
  }
  instance = new EventBusInProcess(eventStore);
  return instance;
}

function parseList(v?: string): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function buildKafkaSasl(): { mechanism: string; username: string; password: string } | undefined {
  const mechanism = process.env.KAFKA_SASL_MECHANISM;
  const username = process.env.KAFKA_SASL_USERNAME;
  const password = process.env.KAFKA_SASL_PASSWORD;
  return mechanism && username && password ? { mechanism, username, password } : undefined;
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
  transient?: boolean;
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
    ...(input.transient ? { transient: true } : {}),
  };
}

export * from './types';
export * from './EventBus';
export * from './signals';
export { MongoEventStore, DOMAIN_EVENT_COLLECTION } from './EventStore';
export type { EventStore } from './EventStore';

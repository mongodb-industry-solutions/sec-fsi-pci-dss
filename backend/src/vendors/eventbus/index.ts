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
import { config } from '../../config';

let instance: EventBus | null = null;

// The bus engine is chosen by configuration (Strategy pattern): switching engines needs no
// publisher/consumer code change, only this selection. Every engine implements the same EventBus port.
export type EventBusEngine = 'in-process' | 'kafka' | 'rabbitmq';

const SUPPORTED_ENGINES = ['in-process', 'kafka', 'rabbitmq'] as const;

// Returns the value only if it is a supported engine; otherwise null (blank/unknown → null).
function coerceEngine(value: string | undefined | null): EventBusEngine | null {
  const v = value?.trim();
  return v && (SUPPORTED_ENGINES as readonly string[]).includes(v) ? (v as EventBusEngine) : null;
}

export function resolveEventBusEngine(): EventBusEngine {
  // Read live from the environment (PSP_-prefixed, then legacy) so the engine can be selected at
  // startup regardless of when the config snapshot was taken. Validate against SUPPORTED_ENGINES:
  // an unsupported or blank value must NOT silently resolve to in-process (that masks a production
  // misconfiguration) — warn, then fall back to the validated config default (ultimately in-process).
  const fromEnv = process.env.PSP_EVENT_BUS_ENGINE ?? process.env.EVENT_BUS_ENGINE;
  const envEngine = coerceEngine(fromEnv);
  if (envEngine) return envEngine;
  if (fromEnv?.trim()) {
    console.warn(
      `[eventbus] Ignoring unsupported EVENT_BUS_ENGINE="${fromEnv}". ` +
      `Supported: ${SUPPORTED_ENGINES.join(', ')}. Falling back to "${config.app.eventBusEngine}".`,
    );
  }
  return coerceEngine(config.app.eventBusEngine) ?? 'in-process';
}

export function initEventBus(db: Db, store?: EventStore): EventBus {
  const engine = resolveEventBusEngine();
  const eventStore = store ?? new MongoEventStore(db);
  const topic = `${config.app.eventBusTopicPrefix}.domain-events`;

  if (engine === 'kafka') {
    instance = new EventBusKafka({ brokers: config.kafka.brokers, clientId: config.kafka.clientId, ssl: config.kafka.ssl, sasl: buildKafkaSasl(), topic }, eventStore);
    return instance;
  }
  if (engine === 'rabbitmq') {
    instance = new EventBusRabbit({ url: config.rabbitmq.url, exchange: topic, topic }, eventStore);
    return instance;
  }
  instance = new EventBusInProcess(eventStore);
  return instance;
}

function buildKafkaSasl(): { mechanism: string; username: string; password: string } | undefined {
  const mechanism = config.kafka.saslMechanism;
  const username = config.kafka.saslUsername;
  const password = config.kafka.saslPassword;
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

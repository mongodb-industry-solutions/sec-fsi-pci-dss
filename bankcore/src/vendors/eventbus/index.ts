// bankcore binding for the shared @leafypay/eventbus package: its own settings, its own database,
// its own domainEvent store. The PSP has an equivalent binding; the implementation is shared.
import {
  initEventBus as initSharedEventBus,
  resolveEventBusEngine as resolveSharedEngine,
  type EventBus,
  type EventBusEngine,
  type EventBusSettings,
  type EventStore,
  type EventStoreDb,
} from '@leafypay/eventbus';
import { config } from '../../config';

function bankSettings(): EventBusSettings {
  return {
    engine: config.app.eventBusEngine,
    topicPrefix: config.app.eventBusTopicPrefix,
    kafka: {
      brokers: config.kafka.brokers,
      clientId: config.kafka.clientId,
      ssl: config.kafka.ssl,
      saslMechanism: config.kafka.saslMechanism,
      saslUsername: config.kafka.saslUsername,
      saslPassword: config.kafka.saslPassword,
    },
    rabbitmq: { url: config.rabbitmq.url },
  };
}

export function initEventBus(db: EventStoreDb, store?: EventStore): EventBus {
  return initSharedEventBus(db, bankSettings(), store);
}

export function resolveEventBusEngine(): EventBusEngine {
  return resolveSharedEngine(config.app.eventBusEngine);
}

export * from '@leafypay/eventbus';

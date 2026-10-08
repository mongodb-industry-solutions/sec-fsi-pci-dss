// PSP binding for the shared @ist-sec/eventbus package: supplies this service's settings and DB.
// The implementation lives in packages/eventbus, so bankcore reuses it instead of copying it.
import type { Db } from 'mongodb';
import {
  initEventBus as initSharedEventBus,
  resolveEventBusEngine as resolveSharedEngine,
  type EventBus,
  type EventBusEngine,
  type EventBusSettings,
  type EventStore,
} from '@ist-sec/eventbus';
import { config } from '../../config';

function pspSettings(): EventBusSettings {
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

export function initEventBus(db: Db, store?: EventStore): EventBus {
  return initSharedEventBus(db, pspSettings(), store);
}

export function resolveEventBusEngine(): EventBusEngine {
  return resolveSharedEngine(config.app.eventBusEngine);
}

export * from '@ist-sec/eventbus';

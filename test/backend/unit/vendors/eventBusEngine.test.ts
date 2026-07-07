/**
 * Unit tests: the Event Bus engine is selected by configuration (Strategy pattern). `in-process` is
 * the default; `kafka` and `rabbitmq` build a broker adapter behind the same port (the broker client
 * connects on start(), not at construction). No DB beyond an injected store.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolveEventBusEngine, initEventBus } from '../../../../backend/src/vendors/eventbus';
import { BrokerEventBus } from '../../../../backend/src/vendors/eventbus/BrokerEventBus';
import { EventBusInProcess } from '../../../../backend/src/vendors/eventbus/EventBusInProcess';
import type { EventStore } from '../../../../backend/src/vendors/eventbus/EventStore';
import type { DomainEvent } from '../../../../backend/src/vendors/eventbus/types';

const fakeStore: EventStore = {
  async append() {}, async trail() { return [] as DomainEvent[]; }, async byProcess() { return [] as DomainEvent[]; },
};
const db = {} as never;

afterEach(() => { delete process.env.PSP_EVENT_BUS_ENGINE; });

describe('Event Bus engine selection', () => {
  it('defaults to in-process when EVENT_BUS_ENGINE is unset', () => {
    expect(resolveEventBusEngine()).toBe('in-process');
    expect(() => initEventBus(db, fakeStore)).not.toThrow();
  });

  it('honors an explicit in-process engine', () => {
    process.env.PSP_EVENT_BUS_ENGINE = 'in-process';
    expect(resolveEventBusEngine()).toBe('in-process');
    expect(() => initEventBus(db, fakeStore)).not.toThrow();
  });

  it('builds a broker adapter for kafka (connects lazily on start, not at construction)', () => {
    process.env.PSP_EVENT_BUS_ENGINE = 'kafka';
    expect(resolveEventBusEngine()).toBe('kafka');
    expect(initEventBus(db, fakeStore)).toBeInstanceOf(BrokerEventBus);
  });

  it('builds a broker adapter for rabbitmq', () => {
    process.env.PSP_EVENT_BUS_ENGINE = 'rabbitmq';
    expect(initEventBus(db, fakeStore)).toBeInstanceOf(BrokerEventBus);
  });

  it('falls back to the config default when the engine value is unsupported', () => {
    process.env.PSP_EVENT_BUS_ENGINE = 'kafkaa'; // typo / unsupported → must not silently pick kafka nor a bogus engine
    expect(resolveEventBusEngine()).toBe('in-process');
    expect(initEventBus(db, fakeStore)).toBeInstanceOf(EventBusInProcess);
  });

  it('falls back when the engine value is blank (empty string)', () => {
    process.env.PSP_EVENT_BUS_ENGINE = '   ';
    expect(resolveEventBusEngine()).toBe('in-process');
  });
});

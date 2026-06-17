/**
 * Unit tests (dev.v8 P8, §3.1): the Event Bus engine is selected by configuration (Strategy pattern).
 * `in-process` is the default and implemented; broker engines plug into the same port and otherwise
 * fail fast with a clear message. No DB beyond an injected store.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resolveEventBusEngine, initEventBus } from '../../../../backend/src/vendors/eventbus';
import type { EventStore } from '../../../../backend/src/vendors/eventbus/EventStore';
import type { DomainEvent } from '../../../../backend/src/vendors/eventbus/types';

const fakeStore: EventStore = {
  async append() {}, async trail() { return [] as DomainEvent[]; }, async byProcess() { return [] as DomainEvent[]; },
};
const db = {} as never;

afterEach(() => { delete process.env.EVENT_BUS_ENGINE; });

describe('Event Bus engine selection (§3.1)', () => {
  it('defaults to in-process when EVENT_BUS_ENGINE is unset', () => {
    expect(resolveEventBusEngine()).toBe('in-process');
    expect(() => initEventBus(db, fakeStore)).not.toThrow();
  });

  it('honors an explicit in-process engine', () => {
    process.env.EVENT_BUS_ENGINE = 'in-process';
    expect(resolveEventBusEngine()).toBe('in-process');
    expect(() => initEventBus(db, fakeStore)).not.toThrow();
  });

  it('fails fast with a clear message for an unwired broker engine', () => {
    process.env.EVENT_BUS_ENGINE = 'kafka';
    expect(() => initEventBus(db, fakeStore)).toThrow(/not wired yet/);
  });
});

/**
 * Bus conformance suite: one behavioural contract run against every EventBus adapter. Passing on all
 * engines is the swap guarantee: publishers/consumers see identical behaviour regardless of engine.
 * The broker adapter is exercised through a fake transport (the real Kafka/Rabbit clients run only
 * when those engines are selected; their logic IS this BrokerEventBus).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBusInProcess } from '@leafypay/eventbus';
import { BrokerEventBus } from '@leafypay/eventbus';
import { EventBusKafka } from '@leafypay/eventbus';
import { EventBusRabbit } from '@leafypay/eventbus';
import { BrokerTransport, BrokerMessage } from '@leafypay/eventbus';
import { EventStore } from '@leafypay/eventbus';
import { EventBus } from '@leafypay/eventbus';
import { makeEvent, DomainEvent } from '../../../../backend/src/vendors/eventbus';

const flush = () => new Promise((r) => setTimeout(r, 0));

class FakeStore implements EventStore {
  appended: DomainEvent[] = [];
  async append(e: DomainEvent) { this.appended.push(e); }
  async trail() { return this.appended; }
  async byProcess() { return this.appended; }
}

// In-memory transport: produce delivers to the single registered consumer in order.
class FakeTransport implements BrokerTransport {
  private handler?: (m: BrokerMessage) => Promise<void>;
  connected = false;
  async connect() { this.connected = true; }
  async disconnect() { this.connected = false; this.handler = undefined; }
  async produce(_topic: string, msg: BrokerMessage) { if (this.handler) await this.handler(msg); }
  async consume(_topic: string, _group: string, handler: (m: BrokerMessage) => Promise<void>) { this.handler = handler; }
}

interface Factory { name: string; make: (store: EventStore) => EventBus; }

const factories: Factory[] = [
  { name: 'EventBusInProcess', make: (store) => new EventBusInProcess(store) },
  { name: 'BrokerEventBus (fake transport)', make: (store) => new BrokerEventBus(new FakeTransport(), { topic: 't', store }) },
];

describe.each(factories)('EventBus conformance: $name', ({ make }) => {
  let store: FakeStore;
  let bus: EventBus;

  beforeEach(async () => {
    store = new FakeStore();
    bus = make(store);
    await bus.start();
  });

  it('delivers a published event to an exact-type subscriber exactly once', async () => {
    const got: string[] = [];
    bus.subscribe('a.b', (e) => { got.push(e.eventId); });
    await bus.publish(makeEvent({ eventType: 'a.b', correlationId: 'c1', businessProcess: 'system', payload: {} }));
    await flush();
    expect(got).toHaveLength(1);
  });

  it('matches wildcard patterns and ignores non-matching types', async () => {
    const got: string[] = [];
    bus.subscribe('a.*', (e) => { got.push(e.eventType); });
    await bus.publish(makeEvent({ eventType: 'a.one', correlationId: 'c1', businessProcess: 'system', payload: {} }));
    await bus.publish(makeEvent({ eventType: 'b.two', correlationId: 'c1', businessProcess: 'system', payload: {} }));
    await flush();
    expect(got).toEqual(['a.one']);
  });

  it('scopes a correlationId subscription to its own journey', async () => {
    const got: string[] = [];
    bus.subscribe('x.y', (e) => { got.push(e.correlationId); }, { correlationId: 'mine' });
    await bus.publish(makeEvent({ eventType: 'x.y', correlationId: 'other', businessProcess: 'system', payload: {} }));
    await bus.publish(makeEvent({ eventType: 'x.y', correlationId: 'mine', businessProcess: 'system', payload: {} }));
    await flush();
    expect(got).toEqual(['mine']);
  });

  it('preserves order within a journey (partition key = correlationId)', async () => {
    const got: number[] = [];
    bus.subscribe('seq.ev', (e) => { got.push((e.payload as { n: number }).n); });
    for (const n of [1, 2, 3, 4, 5]) {
      await bus.publish(makeEvent({ eventType: 'seq.ev', correlationId: 'j1', businessProcess: 'system', payload: { n } }));
    }
    await flush();
    expect(got).toEqual([1, 2, 3, 4, 5]);
  });

  it('persists non-transient events to the store and skips transient ones', async () => {
    await bus.publish(makeEvent({ eventType: 'p.persist', correlationId: 'c1', businessProcess: 'system', payload: {} }));
    await bus.publish(makeEvent({ eventType: 'p.signal', correlationId: 'c1', businessProcess: 'system', payload: {}, transient: true }));
    await flush();
    expect(store.appended.map((e) => e.eventType)).toEqual(['p.persist']);
  });

  it('isolates a failing handler from the others', async () => {
    const got: string[] = [];
    bus.subscribe('iso.ev', () => { throw new Error('boom'); });
    bus.subscribe('iso.ev', (e) => { got.push(e.eventId); });
    await bus.publish(makeEvent({ eventType: 'iso.ev', correlationId: 'c1', businessProcess: 'system', payload: {} }));
    await flush();
    expect(got).toHaveLength(1);
  });

  it('stops delivering after unsubscribe', async () => {
    const got: string[] = [];
    const sub = bus.subscribe('u.ev', (e) => { got.push(e.eventId); });
    sub.unsubscribe();
    await bus.publish(makeEvent({ eventType: 'u.ev', correlationId: 'c1', businessProcess: 'system', payload: {} }));
    await flush();
    expect(got).toHaveLength(0);
  });
});

describe('broker adapter specifics', () => {
  it('dedupes redelivered messages by eventId (at-least-once → effectively-once)', async () => {
    const transport = new FakeTransport();
    const store = new FakeStore();
    const bus = new BrokerEventBus(transport, { topic: 't', store });
    await bus.start();
    const got: string[] = [];
    bus.subscribe('d.ev', (e) => { got.push(e.eventId); });
    const event = makeEvent({ eventType: 'd.ev', correlationId: 'c1', businessProcess: 'system', payload: {} });
    await bus.publish(event);
    await transport.produce('t', { key: 'c1', value: Buffer.from(JSON.stringify(event)), headers: {} }); // redelivery
    await flush();
    expect(got).toHaveLength(1);
    expect(store.appended).toHaveLength(1);
  });

  it('the named Kafka/Rabbit adapters are BrokerEventBus instances (share the contract)', () => {
    expect(new EventBusKafka({ brokers: [], topic: 't' })).toBeInstanceOf(BrokerEventBus);
    expect(new EventBusRabbit({ url: 'amqp://localhost', exchange: 't', topic: 't' })).toBeInstanceOf(BrokerEventBus);
  });
});

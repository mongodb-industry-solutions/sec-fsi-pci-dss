/**
 * Unit tests: EventBus vendor (dev.v8 F1). Pure, no DB. Uses an injectable in-memory EventStore.
 * Validates the stable contract: publish persists (CHD-sanitized), pattern subscribe/wildcard
 * delivery, idempotency by eventId, and the correlated trail.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBusInProcess } from '../../../../backend/src/vendors/eventbus/EventBusInProcess';
import type { EventStore } from '../../../../backend/src/vendors/eventbus/EventStore';
import { makeEvent } from '../../../../backend/src/vendors/eventbus';
import type { DomainEvent } from '../../../../backend/src/vendors/eventbus/types';

class FakeStore implements EventStore {
  events: DomainEvent[] = [];
  async append(e: DomainEvent) { if (!this.events.some(x => x.eventId === e.eventId)) this.events.push(e); }
  async trail(correlationId: string) {
    return this.events.filter(e => e.correlationId === correlationId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
  async byProcess(bp: DomainEvent['businessProcess']) { return this.events.filter(e => e.businessProcess === bp); }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('EventBus vendor (in-process adapter)', () => {
  let store: FakeStore;
  let bus: EventBusInProcess;
  beforeEach(() => { store = new FakeStore(); bus = new EventBusInProcess(store); });

  it('persists every published event to the store', async () => {
    await bus.publish(makeEvent({ eventType: 'payment.authorized', correlationId: 'txn-1', businessProcess: 'card_payment', payload: { amount: 100 } }));
    expect(store.events).toHaveLength(1);
    expect(store.events[0].eventType).toBe('payment.authorized');
    expect(store.events[0].partitionKey).toBe('txn-1'); // defaults to correlationId
  });

  it('strips cardholder data from the payload before storing (PCI Req 3.2)', async () => {
    await bus.publish(makeEvent({
      eventType: 'cardissuer.validation.requested', correlationId: 'txn-2', businessProcess: 'card_payment',
      payload: { cardNumber: '4242424242424242', cvv: '123', expiry: '12/30', maskedPan: '****-****-****-4242' },
    }));
    const stored = store.events[0].payload as Record<string, unknown>;
    expect(stored.cardNumber).toBeUndefined();
    expect(stored.cvv).toBeUndefined();
    expect(stored.expiry).toBeUndefined();
    expect(stored.maskedPan).toBe('****-****-****-4242'); // masked PAN is safe and kept
    expect(JSON.stringify(store.events[0])).not.toContain('4242424242424242');
  });

  it('delivers to an exact-match subscriber and not to others', async () => {
    const hit: string[] = [];
    bus.subscribe('payment.authorized', (e) => { hit.push(e.eventType); });
    await bus.publish(makeEvent({ eventType: 'payment.authorized', correlationId: 'c', businessProcess: 'card_payment', payload: {} }));
    await bus.publish(makeEvent({ eventType: 'payment.declined', correlationId: 'c', businessProcess: 'card_payment', payload: {} }));
    await flush();
    expect(hit).toEqual(['payment.authorized']);
  });

  it('supports wildcard patterns', async () => {
    const hit: string[] = [];
    bus.subscribe('payment.*', (e) => { hit.push(e.eventType); });
    bus.subscribe('*', () => { hit.push('ALL'); });
    await bus.publish(makeEvent({ eventType: 'payment.authorization.requested', correlationId: 'c', businessProcess: 'card_payment', payload: {} }));
    await bus.publish(makeEvent({ eventType: 'fraud.scoring.completed', correlationId: 'c', businessProcess: 'card_payment', payload: {} }));
    await flush();
    expect(hit.filter(h => h === 'payment.authorization.requested')).toHaveLength(1); // payment.* matched once
    expect(hit.filter(h => h === 'ALL')).toHaveLength(2); // '*' matched both
  });

  it('is idempotent on duplicate eventId', async () => {
    const e = makeEvent({ eventType: 'payment.authorized', correlationId: 'c', businessProcess: 'card_payment', payload: {} });
    await bus.publish(e);
    await bus.publish(e); // same eventId
    expect(store.events).toHaveLength(1);
  });

  it('returns the correlated trail in time order', async () => {
    await bus.publish({ ...makeEvent({ eventType: 'b', correlationId: 'j', businessProcess: 'card_payment', payload: {} }), occurredAt: '2026-01-01T00:00:02.000Z' });
    await bus.publish({ ...makeEvent({ eventType: 'a', correlationId: 'j', businessProcess: 'card_payment', payload: {} }), occurredAt: '2026-01-01T00:00:01.000Z' });
    await bus.publish({ ...makeEvent({ eventType: 'x', correlationId: 'other', businessProcess: 'card_payment', payload: {} }), occurredAt: '2026-01-01T00:00:03.000Z' });
    const trail = await store.trail('j');
    expect(trail.map(e => e.eventType)).toEqual(['a', 'b']);
  });

  it('delivers transient events but does not persist them', async () => {
    const hit: string[] = [];
    bus.subscribe('party.notification', (e) => { hit.push(e.eventType); });
    await bus.publish(makeEvent({ eventType: 'party.notification', correlationId: 'p', businessProcess: 'system', payload: {}, transient: true }));
    await flush();
    expect(hit).toEqual(['party.notification']); // delivered
    expect(store.events).toHaveLength(0);        // not persisted
  });

  it('isolates a throwing handler from the rest', async () => {
    const hit: string[] = [];
    bus.subscribe('*', () => { throw new Error('boom'); });
    bus.subscribe('*', () => { hit.push('ok'); });
    await bus.publish(makeEvent({ eventType: 'payment.authorized', correlationId: 'c', businessProcess: 'card_payment', payload: {} }));
    await flush();
    expect(hit).toEqual(['ok']);
  });
});

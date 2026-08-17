/**
 * Unit tests (dev.v8 F2): emitted business/compliance events are mirrored onto the correlated
 * event store, so a journey is traceable by correlationId. Pure: an injected in-memory store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBusInProcess } from '@leafypay/eventbus';
import { setEventBus } from '../../../../backend/src/vendors/eventbus';
import type { EventStore } from '@leafypay/eventbus';
import type { DomainEvent } from '@leafypay/eventbus';
import { emitProcessEvent } from '../../../../backend/src/modules/provider/services/businessProcessEvent.service';

class FakeStore implements EventStore {
  events: DomainEvent[] = [];
  async append(e: DomainEvent) { this.events.push(e); }
  async trail(c: string) { return this.events.filter(e => e.correlationId === c); }
  async byProcess(b: DomainEvent['businessProcess']) { return this.events.filter(e => e.businessProcess === b); }
}

// Minimal db stub: the legacy insert is fire-and-forget and wrapped in try/catch.
const mockDb = { collection: () => ({ insertOne: () => Promise.resolve() }) } as never;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('F2: emitted events mirror to the correlated store', () => {
  let store: FakeStore;
  beforeEach(() => { store = new FakeStore(); setEventBus(new EventBusInProcess(store)); });

  it('mirrors with correlationId=entityId and mapped businessProcess', async () => {
    emitProcessEvent(mockDb, {
      entityType: 'transaction', entityId: 'evt-mirror-biz-1', processType: 'payment_processing',
      processAction: 'transaction.authorized', processOutcome: 'approved',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: { amount: 100 }, bianServiceDomain: 'Card Transaction', bianControlRecordType: 'CardTransactionLog',
    });
    await flush();
    const trail = await store.trail('evt-mirror-biz-1');
    expect(trail).toHaveLength(1);
    expect(trail[0].eventType).toBe('transaction.authorized');
    expect(trail[0].businessProcess).toBe('card_payment');
    expect((trail[0].payload as Record<string, unknown>).outcome).toBe('approved');
  });

  it('strips CHD from the mirrored payload (PCI Req 3.2)', async () => {
    emitProcessEvent(mockDb, {
      entityType: 'transaction', entityId: 'evt-mirror-chd-1', processType: 'card_authorization',
      processAction: 'auth', processOutcome: 'approved',
      performedByPartyReference: null, performedByRole: null,
      eventSummary: { cvv: '123', cardNumber: '4242424242424242', maskedPan: '****-1212' },
      bianServiceDomain: '', bianControlRecordType: '',
    });
    await flush();
    const p = (await store.trail('evt-mirror-chd-1'))[0].payload as Record<string, unknown>;
    expect(p.cvv).toBeUndefined();
    expect(p.cardNumber).toBeUndefined();
    expect(p.maskedPan).toBe('****-1212');
  });

  it('correlated trail groups all events of one journey', async () => {
    for (const action of ['transaction.authorized', 'card.matched', 'payment.callback']) {
      emitProcessEvent(mockDb, {
        entityType: 'transaction', entityId: 'evt-mirror-journey-1', processType: 'payment_processing',
        processAction: action, processOutcome: 'approved',
        performedByPartyReference: null, performedByRole: null,
        eventSummary: {}, bianServiceDomain: '', bianControlRecordType: '',
      });
    }
    await flush();
    const trail = await store.trail('evt-mirror-journey-1');
    expect(trail.map(e => e.eventType)).toEqual(['transaction.authorized', 'card.matched', 'payment.callback']);
  });
});

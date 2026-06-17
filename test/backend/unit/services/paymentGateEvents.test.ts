/**
 * Unit tests (dev.v8 P5): every Phase-1 provider call is a *.requested -> *.completed PAIR on the bus
 * (§6.1 rule 3) with the causation chain (§5.0): each gate.requested.causationId = process.requested,
 * and each gate.completed.causationId = its own gate.requested. Plus the PendingCorrelation registry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const insertOne = vi.fn().mockResolvedValue({ insertedId: 'm' });
  const findOne = vi.fn().mockResolvedValue(null);
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const qeDb = { collection: vi.fn(() => ({ insertOne, findOne, updateOne })) };
  return { qeDb, getDbForRole: vi.fn().mockResolvedValue(qeDb), dispatchProvider: vi.fn().mockResolvedValue({ provider: 'internal', status: 'received' }) };
});
vi.mock('../../../../backend/src/vendors/encryption/roleClients', () => ({ getDbForRole: h.getDbForRole }));
vi.mock('../../../../backend/src/vendors/security/escalationTokens', () => ({ validateToken: vi.fn().mockReturnValue({ valid: false }) }));
vi.mock('../../../../backend/src/modules/fraud/services/fraudDiagnosis.service', () => ({ createFraudCase: vi.fn().mockResolvedValue({ fraudDiagnosisInstanceReference: 'f' }) }));
vi.mock('../../../../backend/src/modules/customer/services/paymentCard.service', () => ({
  getCardByToken: vi.fn().mockResolvedValue(null), upsertCardByToken: vi.fn().mockResolvedValue({ paymentCardInstanceReference: 'c', created: false }),
}));
vi.mock('../../../../backend/src/modules/provider/services/integrationDispatch.service', () => ({ dispatchProvider: h.dispatchProvider }));
vi.mock('../../../../backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitProcessEvent: vi.fn(), emitComplianceEvent: vi.fn(),
}));
vi.mock('../../../../backend/src/modules/gateway/services/merchantCallback.service', () => ({ sendMerchantPaymentCallback: vi.fn().mockResolvedValue(undefined) }));

import { createTransaction } from '../../../../backend/src/modules/transaction/services/cardTransaction.service';
import { EventBusInProcess } from '../../../../backend/src/vendors/eventbus/EventBusInProcess';
import type { EventStore } from '../../../../backend/src/vendors/eventbus/EventStore';
import { setEventBus, getEventBus } from '../../../../backend/src/vendors/eventbus';
import type { DomainEvent } from '../../../../backend/src/vendors/eventbus/types';
import { PaymentAuthorizationSaga } from '../../../../backend/src/modules/transaction/services/paymentAuthorization.saga';
import {
  recordPendingCorrelation, resolvePendingCorrelation, clearPendingCorrelation,
  sweepExpiredCorrelations, pendingCorrelationSize,
} from '../../../../backend/src/modules/provider/services/pendingCorrelation.service';

class FakeStore implements EventStore {
  events: DomainEvent[] = [];
  async append(e: DomainEvent) { if (!this.events.some((x) => x.eventId === e.eventId)) this.events.push(e); }
  async trail(c: string) { return this.events.filter((e) => e.correlationId === c); }
  async byProcess(bp: DomainEvent['businessProcess']) { return this.events.filter((e) => e.businessProcess === bp); }
}

const txDb = () => ({ collection: vi.fn(() => ({ findOne: vi.fn().mockResolvedValue(null) })) }) as never;
const baseInput = {
  cardToken: 'tok', accountReference: 'ACC-1', amount: 100, currency: 'USD',
  cardTransactionMerchantName: 'Shop', cardTransactionMerchantCategoryCode: '5411', cardTransactionChannel: 'online',
  cardTransactionMaskedPanDisplay: '****1234', cardTransactionType: 'purchase' as const,
  cardTransactionDescription: 'SHOP', gatewayPayload: { source: 'test' },
};

describe('P5 — per-gate *.requested/*.completed pairs + causation', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
    setEventBus(new EventBusInProcess(store));
    new PaymentAuthorizationSaga(txDb(), getEventBus()).register();
  });

  it('emits a requested->completed pair for every gate, and the closing event', async () => {
    await createTransaction(txDb(), baseInput);
    const types = store.events.map((e) => e.eventType);
    for (const t of [
      'card.payment.authorization.requested',
      'card.issuer.validation.requested', 'card.issuer.validation.completed',
      'fds.scoring.requested', 'fds.scoring.completed',
      'hrp.screening.requested', 'hrp.screening.completed',
      'card.payment.authorization.completed',
    ]) expect(types, `missing ${t}`).toContain(t);
  });

  it('wires the causation chain (§5.0): gate.requested<-process, gate.completed<-gate.requested', async () => {
    await createTransaction(txDb(), baseInput);
    const byType = (t: string) => store.events.find((e) => e.eventType === t)!;
    const proc = byType('card.payment.authorization.requested');
    for (const g of ['card.issuer.validation', 'fds.scoring', 'hrp.screening']) {
      const req = byType(`${g}.requested`);
      const done = byType(`${g}.completed`);
      expect(req.causationId, `${g}.requested causation`).toBe(proc.eventId);
      expect(done.causationId, `${g}.completed causation`).toBe(req.eventId);
    }
  });

  it('records a pending-correlation entry for the issuer at dispatch (§7.7)', async () => {
    await createTransaction(txDb(), baseInput);
    // The sync built-in path leaves the entry for a would-be async callback; it is swept by TTL.
    expect(pendingCorrelationSize()).toBeGreaterThanOrEqual(1);
  });
});

describe('PendingCorrelation registry (§7.7)', () => {
  it('records, resolves, clears, and sweeps by expiry', () => {
    const entry = { ref: 'r1', correlationId: 'r1', causationId: 'c0', businessProcess: 'card_payment', eventType: 'card.issuer.validation.completed' };
    recordPendingCorrelation(entry);
    expect(resolvePendingCorrelation('r1')?.causationId).toBe('c0');
    clearPendingCorrelation('r1');
    expect(resolvePendingCorrelation('r1')).toBeUndefined();

    recordPendingCorrelation({ ...entry, ref: 'r2', expiresAt: new Date(Date.now() - 1000).toISOString() });
    const removed = sweepExpiredCorrelations();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(resolvePendingCorrelation('r2')).toBeUndefined();
  });
});

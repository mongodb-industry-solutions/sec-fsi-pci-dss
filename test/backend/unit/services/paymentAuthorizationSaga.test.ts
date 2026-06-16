/**
 * Unit tests (dev.v8 F4): PaymentAuthorizationSaga aggregates the Phase-1 gates (card-issuer + FDS +
 * sanctions). All approve -> payment.authorized; any hard decline -> payment.declined (without waiting
 * for the remaining gates). cardTransaction.service (complete/decline) is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  completeAuthorized: vi.fn(async () => ({ fraudCaseCreated: false })),
  declineTransaction: vi.fn(async () => {}),
}));
vi.mock('../../../../backend/src/modules/transactions/services/cardTransaction.service', () => ({
  completeAuthorized: h.completeAuthorized,
  declineTransaction: h.declineTransaction,
}));

import { EventBusInProcess } from '../../../../backend/src/vendors/eventbus/EventBusInProcess';
import { makeEvent } from '../../../../backend/src/vendors/eventbus';
import type { Db } from 'mongodb';
import { PaymentAuthorizationSaga } from '../../../../backend/src/modules/transactions/services/paymentAuthorization.saga';

const flush = () => new Promise((r) => setTimeout(r, 15));
const gate = (eventType: string, correlationId: string, approved: boolean, reason?: string) =>
  makeEvent({ eventType, correlationId, businessProcess: 'card_payment' as const, payload: { approved, reason } });

describe('PaymentAuthorizationSaga (Phase-1 gate aggregation)', () => {
  let bus: EventBusInProcess;
  beforeEach(() => {
    h.completeAuthorized.mockClear();
    h.declineTransaction.mockClear();
    bus = new EventBusInProcess();
    new PaymentAuthorizationSaga({} as Db, bus).register();
  });

  function watch(txnId: string): string[] {
    const seen: string[] = [];
    bus.subscribe(['payment.authorized', 'payment.declined'], (e) => seen.push(e.eventType), { correlationId: txnId });
    return seen;
  }

  it('authorizes when all three gates approve', async () => {
    const seen = watch('t1');
    await bus.publish(makeEvent({ eventType: 'payment.authorization.requested', correlationId: 't1', businessProcess: 'card_payment', payload: { gatesExpected: ['cardissuer', 'fds', 'sanctions'] } }));
    await bus.publish(gate('cardissuer.validation.completed', 't1', true));
    await bus.publish(gate('fraud.scoring.completed', 't1', true));
    await bus.publish(gate('sanctions.screening.completed', 't1', true));
    await flush();
    expect(seen).toEqual(['payment.authorized']);
    expect(h.completeAuthorized).toHaveBeenCalledWith({}, 't1');
    expect(h.declineTransaction).not.toHaveBeenCalled();
  });

  it('declines immediately on a hard decline, without waiting for remaining gates', async () => {
    const seen = watch('t2');
    await bus.publish(makeEvent({ eventType: 'payment.authorization.requested', correlationId: 't2', businessProcess: 'card_payment', payload: { gatesExpected: ['cardissuer', 'fds', 'sanctions'] } }));
    await bus.publish(gate('cardissuer.validation.completed', 't2', true));
    await bus.publish(gate('sanctions.screening.completed', 't2', false, 'sanctions_match')); // hard decline
    await flush();
    expect(seen).toEqual(['payment.declined']);
    expect(h.declineTransaction).toHaveBeenCalledWith({}, 't2', 'sanctions_match', 'declined');
    expect(h.completeAuthorized).not.toHaveBeenCalled();
  });

  it('decides only once', async () => {
    const seen = watch('t3');
    await bus.publish(makeEvent({ eventType: 'payment.authorization.requested', correlationId: 't3', businessProcess: 'card_payment', payload: { gatesExpected: ['cardissuer', 'fds', 'sanctions'] } }));
    await bus.publish(gate('cardissuer.validation.completed', 't3', true));
    await bus.publish(gate('fraud.scoring.completed', 't3', true));
    await bus.publish(gate('sanctions.screening.completed', 't3', true));
    await bus.publish(gate('sanctions.screening.completed', 't3', false)); // late/duplicate, must be ignored
    await flush();
    expect(seen).toEqual(['payment.authorized']);
  });
});

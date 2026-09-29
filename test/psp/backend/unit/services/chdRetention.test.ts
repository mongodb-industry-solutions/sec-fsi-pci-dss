/**
 * Unit tests (dev.v8 P7, §8): CHD retention. `chd` is purged ($unset) from the carrier event when the
 * journey closes, and a safety sweep purges abandoned carriers. Field $unset only, never a document
 * delete (the trail record is kept, CHD-free). Pure: a mock db captures the updateMany filter/update.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { purgeChd, sweepAbandonedChd, ChdRetention } from '../../../../../psp/backend/src/modules/transaction/services/chdRetention.service';
import { EventBusInProcess } from '@leafypay/eventbus';
import { makeEvent } from '../../../../../psp/backend/src/vendors/eventbus';

const flush = () => new Promise((r) => setTimeout(r, 0));

function mockDb() {
  const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const db = { collection: vi.fn(() => ({ updateMany })) } as never;
  return { db, updateMany };
}

describe('purgeChd', () => {
  it('$unsets payload.chd for the journey carrier event only', async () => {
    const { db, updateMany } = mockDb();
    const n = await purgeChd(db, 'txn-1');
    expect(n).toBe(1);
    const [filter, update] = updateMany.mock.calls[0];
    expect(filter).toMatchObject({ eventType: 'card.issuer.validation.requested', correlationId: 'txn-1' });
    expect(filter['payload.chd']).toEqual({ $exists: true });
    expect(update).toEqual({ $unset: { 'payload.chd': '' } });
  });
});

describe('sweepAbandonedChd', () => {
  it('$unsets payload.chd from carriers older than the cutoff', async () => {
    const { db, updateMany } = mockDb();
    const now = Date.parse('2026-06-17T12:00:00.000Z');
    await sweepAbandonedChd(db, 15 * 60 * 1000, now);
    const [filter, update] = updateMany.mock.calls[0];
    expect(filter.eventType).toBe('card.issuer.validation.requested');
    expect((filter.occurredAt as { $lt: string }).$lt).toBe('2026-06-17T11:45:00.000Z');
    expect(filter['payload.chd']).toEqual({ $exists: true });
    expect(update).toEqual({ $unset: { 'payload.chd': '' } });
  });
});

describe('ChdRetention subscriber', () => {
  it('purges chd when the journey reaches card.payment.authorization.completed', async () => {
    const { db, updateMany } = mockDb();
    const bus = new EventBusInProcess();
    new ChdRetention(db, bus).register();
    await bus.publish(makeEvent({ eventType: 'card.payment.authorization.completed', correlationId: 'txn-9', businessProcess: 'card_payment', payload: { outcome: 'authorized' } }));
    await flush();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toMatchObject({ correlationId: 'txn-9' });
  });

  it('does not purge for unrelated events', async () => {
    const { db, updateMany } = mockDb();
    const bus = new EventBusInProcess();
    new ChdRetention(db, bus).register();
    await bus.publish(makeEvent({ eventType: 'fds.scoring.completed', correlationId: 'txn-9', businessProcess: 'card_payment', payload: { outcome: 'approved' } }));
    await flush();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

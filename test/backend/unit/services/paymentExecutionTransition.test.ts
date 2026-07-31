/**
 * Unit tests: the execution state transition is the idempotency gate for money movement.
 * Source: backend/src/modules/gateway/services/paymentExecution.service.ts (transitionExecution)
 *
 * Every rail callback handler asks transitionExecution whether IT performed the change, and only
 * then credits, debits or reverses a balance. A rail that redelivers bank.transfer.settled must
 * therefore get `false` on the second delivery. The status has to be part of the filter for that:
 * the update always writes fresh timestamps, so matching on the reference alone would report a
 * modification every time and the ledger legs would be applied twice.
 */
import { describe, it, expect, vi } from 'vitest';
import { transitionExecution } from '../../../../backend/src/modules/gateway/services/paymentExecution.service';

// Db double that honours the filter against one stored execution, so the assertions are about
// behaviour under redelivery rather than about the shape of the query.
function makeDb(currentStatus: string) {
  const doc: Record<string, unknown> = {
    paymentExecutionInstanceReference: 'exec-1',
    paymentExecutionStatus: currentStatus,
  };
  const filters: Record<string, unknown>[] = [];
  const db = {
    collection: vi.fn(() => ({
      updateOne: vi.fn(async (filter: Record<string, any>, update: { $set: Record<string, unknown> }) => {
        filters.push(filter);
        const refOk = filter.paymentExecutionInstanceReference === doc.paymentExecutionInstanceReference;
        const statusOk = filter.paymentExecutionStatus?.$ne !== doc.paymentExecutionStatus;
        if (!refOk || !statusOk) return { modifiedCount: 0 };
        Object.assign(doc, update.$set);
        return { modifiedCount: 1 };
      }),
    })),
  } as any;
  return { db, doc, filters };
}

describe('transitionExecution', () => {
  it('reports the transition it performed', async () => {
    const { db, doc } = makeDb('in_flight');
    expect(await transitionExecution(db, 'exec-1', 'completed', { completedAt: new Date() })).toBe(true);
    expect(doc.paymentExecutionStatus).toBe('completed');
  });

  it('reports false on a redelivered event, so the balance legs run once', async () => {
    const { db } = makeDb('in_flight');
    expect(await transitionExecution(db, 'exec-1', 'completed', { completedAt: new Date() })).toBe(true);
    // Same event again: the record is already completed, so nothing may move a second time.
    expect(await transitionExecution(db, 'exec-1', 'completed', { completedAt: new Date() })).toBe(false);
  });

  it('excludes the target status in the filter, not just the reference', async () => {
    const { db, filters } = makeDb('in_flight');
    await transitionExecution(db, 'exec-1', 'failed');
    expect(filters[0]).toEqual({
      paymentExecutionInstanceReference: 'exec-1',
      paymentExecutionStatus: { $ne: 'failed' },
    });
  });

  it('reports false for an execution that does not exist', async () => {
    const { db } = makeDb('in_flight');
    expect(await transitionExecution(db, 'exec-unknown', 'completed')).toBe(false);
  });
});

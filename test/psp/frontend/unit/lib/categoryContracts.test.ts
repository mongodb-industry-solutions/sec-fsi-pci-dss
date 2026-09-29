/**
 * Unit test (dev.v8 P9): the admin trigger-event catalogue uses the new canonical event taxonomy,
 * the collapsed closing event card.payment.authorization.completed, never the legacy transaction.*.
 */
import { describe, it, expect } from 'vitest';
import { CATEGORY_TRIGGER_EVENTS } from '../../../../../psp/frontend/src/app/system/admin/_components/categoryContracts';

describe('CATEGORY_TRIGGER_EVENTS taxonomy alignment (§9.1)', () => {
  const allEvents = Object.values(CATEGORY_TRIGGER_EVENTS).flat().map((e) => e.event);

  it('contains no legacy payment/transaction event names', () => {
    for (const legacy of ['transaction.authorized', 'transaction.declined', 'payment.authorized', 'payment.declined']) {
      expect(allEvents).not.toContain(legacy);
    }
  });

  it('uses the collapsed closing event for authorization triggers', () => {
    expect(allEvents).toContain('card.payment.authorization.completed');
  });
});

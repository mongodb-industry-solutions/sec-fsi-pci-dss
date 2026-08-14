/**
 * Unit tests: frontend/src/lib/paymentStatus.ts
 * Covers the regression that blanked the payment history in production: a `disputed` card row hit a
 * status fallback with no Icon, so React rendered `<undefined />` (error #130) and the page died.
 */
import { describe, it, expect } from 'vitest';
import { PAYMENT_STATUS, paymentStatusMeta } from '../../../../frontend/src/lib/paymentStatus';

// Every state the movement list can receive: card transactions, payment executions and RTP intents.
const KNOWN_STATES = [
  'authorized', 'settled', 'captured', 'pending', 'declined', 'voided', 'refunded', 'failed',
  'expired', 'completed', 'disputed', 'reversed', 'rejected', 'cancelled',
  'created', 'validated', 'presented', 'delivered', 'viewed', 'accepted',
  'in_flight', 'routing', 'submitted', 'payment_initiated', 'payment_processing',
  'payment_settled', 'payment_failed', 'exception',
];

describe('paymentStatusMeta', () => {
  it('always resolves an Icon, whatever the state', () => {
    for (const state of KNOWN_STATES) {
      expect(paymentStatusMeta(state).Icon, `no Icon for "${state}"`).toBeTruthy();
    }
  });

  it('resolves an Icon for a missing, empty or unheard-of state', () => {
    for (const state of [undefined, null, '', '  ', 'brand_new_state']) {
      expect(paymentStatusMeta(state).Icon).toBeTruthy();
    }
  });

  it('maps disputed explicitly, the state that triggered the outage', () => {
    expect(PAYMENT_STATUS.disputed).toBeDefined();
    expect(paymentStatusMeta('disputed').label).toBe('Disputed');
  });

  it('labels an unmapped state readably instead of leaving it raw', () => {
    expect(paymentStatusMeta('payment_initiated').label).toBe('payment initiated');
    expect(paymentStatusMeta(null).label).toBe('unknown');
  });

  it('declares an Icon on every mapped entry', () => {
    for (const [state, meta] of Object.entries(PAYMENT_STATUS)) {
      expect(meta.Icon, `no Icon for "${state}"`).toBeTruthy();
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });
});

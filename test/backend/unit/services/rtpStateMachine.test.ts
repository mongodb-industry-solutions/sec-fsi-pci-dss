/**
 * Unit tests: RTP lifecycle state machine (v28, FR-v28-02).
 * Source: backend/src/modules/gateway/services/rtpStateMachine.ts
 */
import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, RtpTransitionError, EXPIRABLE_STATUSES } from '../../../../backend/src/modules/gateway/services/rtpStateMachine';

describe('RTP state machine', () => {
  it('allows the happy-path lifecycle', () => {
    expect(canTransition('created', 'presented')).toBe(true);
    expect(canTransition('presented', 'accepted')).toBe(true);
    expect(canTransition('accepted', 'payment_initiated')).toBe(true);
    expect(canTransition('payment_initiated', 'payment_settled')).toBe(true);
  });

  it('is monotonic: forbids moving backwards or skipping gates', () => {
    expect(canTransition('accepted', 'created')).toBe(false);
    expect(canTransition('created', 'accepted')).toBe(false); // must be presented first
    expect(canTransition('payment_settled', 'presented')).toBe(false);
  });

  it('terminal states have no outgoing transitions', () => {
    expect(canTransition('rejected', 'accepted')).toBe(false);
    expect(canTransition('cancelled', 'presented')).toBe(false);
    expect(canTransition('expired', 'presented')).toBe(false);
    expect(canTransition('payment_failed', 'payment_settled')).toBe(false);
  });

  it('assertTransition throws on an invalid transition', () => {
    expect(() => assertTransition('created', 'payment_settled')).toThrow(RtpTransitionError);
    expect(() => assertTransition('presented', 'accepted')).not.toThrow();
  });

  it('only pre-acceptance states are expirable', () => {
    expect(EXPIRABLE_STATUSES).toContain('presented');
    expect(EXPIRABLE_STATUSES).not.toContain('accepted');
    expect(EXPIRABLE_STATUSES).not.toContain('payment_settled');
  });
});

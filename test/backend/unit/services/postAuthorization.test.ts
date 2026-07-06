/**
 * Unit tests (dev.v8 F5): extractSubsystemSignals collapses a journey's correlated event trail into
 * the latest verdict per subsystem (issuer + FDS + HRP/sanctions + AML) for case enrichment. Pure.
 */
import { describe, it, expect } from 'vitest';
import { extractSubsystemSignals } from '../../../../backend/src/modules/transaction/services/postAuthorization.process';
import { makeEvent } from '../../../../backend/src/vendors/eventbus';

const ev = (eventType: string, payload: Record<string, unknown>) =>
  makeEvent({ eventType, correlationId: 't', businessProcess: 'card_payment' as const, payload });

describe('extractSubsystemSignals', () => {
  it('collapses the trail into the latest verdict per subsystem', () => {
    const s = extractSubsystemSignals([
      ev('card.issuer.validation.completed', { outcome: 'approved', responseCode: '00' }),
      ev('fds.scoring.completed', { outcome: 'approved' }),
      ev('hrp.screening.completed', { outcome: 'declined', reason: 'sanctions_match' }),
      ev('aml.monitoring.completed', { alert: true, severity: 'high' }),
    ]);
    expect(s.issuer).toEqual({ approved: true, responseCode: '00' });
    expect(s.fds).toEqual({ approved: true, reason: null });
    expect(s.hrp).toEqual({ approved: false, reason: 'sanctions_match' });
    expect(s.aml).toEqual({ alert: true, severity: 'high' });
  });

  it('returns null for missing subsystems and uses the latest of duplicates', () => {
    const s = extractSubsystemSignals([
      ev('card.issuer.validation.completed', { outcome: 'declined', responseCode: '12' }),
      ev('card.issuer.validation.completed', { outcome: 'approved', responseCode: '00' }), // later wins
    ]);
    expect(s.issuer).toEqual({ approved: true, responseCode: '00' });
    expect(s.fds).toBeNull();
    expect(s.hrp).toBeNull();
    expect(s.aml).toBeNull();
  });
});

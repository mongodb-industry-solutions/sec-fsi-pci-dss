/**
 * Unit tests (dev.v8 F5): extractSubsystemSignals collapses a journey's correlated event trail into
 * the latest verdict per subsystem (issuer + FDS + sanctions + AML) for case enrichment. Pure.
 */
import { describe, it, expect } from 'vitest';
import { extractSubsystemSignals } from '../../../../backend/src/modules/transactions/services/postAuthorization.process';
import { makeEvent } from '../../../../backend/src/vendors/eventbus';

const ev = (eventType: string, payload: Record<string, unknown>) =>
  makeEvent({ eventType, correlationId: 't', businessProcess: 'card_payment' as const, payload });

describe('extractSubsystemSignals', () => {
  it('collapses the trail into the latest verdict per subsystem', () => {
    const s = extractSubsystemSignals([
      ev('cardissuer.validation.completed', { approved: true, responseCode: '00' }),
      ev('fraud.scoring.completed', { approved: true }),
      ev('sanctions.screening.completed', { approved: false, reason: 'sanctions_match' }),
      ev('aml.monitoring.completed', { alert: true, severity: 'high' }),
    ]);
    expect(s.issuer).toEqual({ approved: true, responseCode: '00' });
    expect(s.fds).toEqual({ approved: true, reason: null });
    expect(s.sanctions).toEqual({ approved: false, reason: 'sanctions_match' });
    expect(s.aml).toEqual({ alert: true, severity: 'high' });
  });

  it('returns null for missing subsystems and uses the latest of duplicates', () => {
    const s = extractSubsystemSignals([
      ev('cardissuer.validation.completed', { approved: false, responseCode: '12' }),
      ev('cardissuer.validation.completed', { approved: true, responseCode: '00' }), // later wins
    ]);
    expect(s.issuer).toEqual({ approved: true, responseCode: '00' });
    expect(s.fds).toBeNull();
    expect(s.sanctions).toBeNull();
    expect(s.aml).toBeNull();
  });
});

/**
 * Unit tests (ADR-061): one risk policy across every movement type.
 *  1. sanctions on a card payment holds and opens a case (it no longer declines);
 *  2. an AML-only alert opens a case and recalls the payout while the rail has not taken it;
 *  3. any AML alert holds a transfer (covered in transferRiskHold.test.ts);
 *  4. a held RTP approval is moved forward by the investigation outcome, not by the payer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  completeAuthorized: vi.fn(async () => ({ fraudCaseCreated: true, fraudDiagnosisInstanceReference: 'case-1' })),
  declineTransaction: vi.fn(async () => {}),
  releaseCardHold: vi.fn(async () => true),
  releasePendingCredit: vi.fn(async () => true),
  createFraudCase: vi.fn(async () => ({ fraudDiagnosisInstanceReference: 'case-aml' })),
  emitProcessEvent: vi.fn(),
  emitComplianceEvent: vi.fn(),
  dispatchProvider: vi.fn(async () => ({ provider: 'internal', status: 'received', responseBody: {} })),
  transitionExecution: vi.fn(async () => true),
  appendResolutionStep: vi.fn(async () => {}),
  getExecution: vi.fn(async () => null),
  transitionRequest: vi.fn(async () => ({})),
  createNotification: vi.fn(async () => {}),
}));
vi.mock('../../../../backend/src/modules/transaction/services/cardTransaction.service', () => ({
  completeAuthorized: h.completeAuthorized, declineTransaction: h.declineTransaction,
}));
vi.mock('../../../../backend/src/modules/gateway/services/payoutAccountBalance.service', () => ({
  releaseCardHold: h.releaseCardHold, releasePendingCredit: h.releasePendingCredit,
  holdCardFunds: vi.fn(async () => true), debitPending: vi.fn(async () => true),
  settleCardDebit: vi.fn(), creditAvailable: vi.fn(), creditDirect: vi.fn(),
}));
vi.mock('../../../../backend/src/modules/fraud/services/fraudDiagnosis.service', () => ({ createFraudCase: h.createFraudCase }));
vi.mock('../../../../backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitProcessEvent: h.emitProcessEvent, emitComplianceEvent: h.emitComplianceEvent,
}));
vi.mock('../../../../backend/src/modules/provider/services/integrationDispatch.service', () => ({ dispatchProvider: h.dispatchProvider }));
vi.mock('../../../../backend/src/modules/gateway/services/paymentExecution.service', () => ({
  transitionExecution: h.transitionExecution, appendResolutionStep: h.appendResolutionStep,
  getExecution: h.getExecution, createExecution: vi.fn(), resolveMerchantFee: vi.fn(),
}));
vi.mock('../../../../backend/src/modules/gateway/services/rtpRequest.service', () => ({
  transitionRequest: h.transitionRequest,
  getRtpRequest: vi.fn(async () => null),
  RtpError: class extends Error {},
}));
vi.mock('../../../../backend/src/modules/notification/notifications.service', () => ({
  createNotification: h.createNotification, markReadByRelated: vi.fn(),
}));

import type { Db } from 'mongodb';
import { EventBusInProcess } from '@leafypay/eventbus';
import { makeEvent } from '../../../../backend/src/vendors/eventbus';
import { PaymentAuthorizationSaga } from '../../../../backend/src/modules/transaction/services/paymentAuthorization.saga';
import { PayoutOrchestrationProcess } from '../../../../backend/src/modules/gateway/services/payoutOrchestration.process';
import { PostAuthorizationProcess } from '../../../../backend/src/modules/transaction/services/postAuthorization.process';
import { RtpLifecycleProcess } from '../../../../backend/src/modules/gateway/services/rtpLifecycle.process';

const flush = () => new Promise((r) => setTimeout(r, 20));
const TXN = 'txn-1';
const GATES = ['card.issuer', 'fds', 'hrp', 'funds'];
const clearMocks = () => { for (const fn of Object.values(h)) (fn as { mockClear?: () => void }).mockClear?.(); };

const gate = (type: string, extra: Record<string, unknown> = {}) => makeEvent({
  eventType: type, correlationId: TXN, businessProcess: 'card_payment' as const,
  payload: { outcome: 'approved', approved: true, ...extra },
});
const start = makeEvent({
  eventType: 'card.payment.authorization.requested', correlationId: TXN,
  businessProcess: 'card_payment' as const, payload: { gatesExpected: GATES },
});

describe('1. sanctions on a card payment: hold + case, never a silent decline', () => {
  let bus: EventBusInProcess;
  beforeEach(() => { clearMocks(); bus = new EventBusInProcess(); new PaymentAuthorizationSaga({} as Db, bus).register(); });

  it('authorizes and hands a review verdict carrying the sanctions indicator', async () => {
    await bus.publish(start);
    await bus.publish(gate('card.issuer.validation.completed'));
    await bus.publish(gate('fds.scoring.completed', { recommendation: 'approve', riskScore: 10, fraudFlag: false, rulesFired: [] }));
    await bus.publish(gate('hrp.screening.completed', { sanctionsMatch: true, reason: 'sanctions_review' }));
    await bus.publish(gate('funds.check.completed', { held: 100, fundingPayoutAccountReference: 'acc-1' }));
    await flush();

    expect(h.declineTransaction).not.toHaveBeenCalled();
    const verdict = h.completeAuthorized.mock.calls[0]?.[2] as unknown as { recommendation: string; fraudFlag: boolean; riskScore: number; rulesFired: string[] };
    expect(verdict).toMatchObject({ recommendation: 'review', fraudFlag: true });
    expect(verdict.rulesFired).toContain('sanctions_match');
    expect(verdict.riskScore).toBeGreaterThanOrEqual(90);
    // The hold stays: nothing is released on an authorized-and-held journey.
    expect(h.releaseCardHold).not.toHaveBeenCalled();
  });

  it('still declines on an eligibility failure (issuer)', async () => {
    await bus.publish(start);
    await bus.publish(makeEvent({
      eventType: 'card.issuer.validation.completed', correlationId: TXN, businessProcess: 'card_payment' as const,
      payload: { outcome: 'declined', approved: false, responseCode: '05', reason: 'invalid_cvv' },
    }));
    await flush();
    expect(h.declineTransaction).toHaveBeenCalledOnce();
  });
});

describe('2. an AML-only alert opens a case and recalls a recallable payout', () => {
  // The execution status decides whether the payout can still be recalled.
  function wire(execStatus: string | null) {
    const exec = execStatus === null ? null : {
      paymentExecutionInstanceReference: 'exec-1', paymentExecutionStatus: execStatus,
      grossAmount: 100, currency: 'USD', resolvedPayoutAccountReference: 'acc-mer', merchantAgreementReference: 'mer-1',
    };
    const db = {
      collection: (name: string) => ({
        findOne: vi.fn(async () => (name === 'paymentExecutionProcedure' ? exec : name === 'fraudDiagnosisCase' ? null : { cardTransactionInstanceReference: TXN, cardTransactionAmount: { amount: 100, currency: 'USD' } })),
        updateOne: vi.fn(async () => ({ matchedCount: 1 })),
      }),
    } as unknown as Db;
    const bus = new EventBusInProcess();
    new PayoutOrchestrationProcess(db, bus).register();
    new PostAuthorizationProcess(db, bus).register();
    return bus;
  }
  const amlAlert = makeEvent({
    eventType: 'aml.monitoring.completed', correlationId: TXN, businessProcess: 'fraud_investigation' as const,
    payload: { transactionId: TXN, outcome: 'alert', alert: true, severity: 'high' },
  });

  beforeEach(clearMocks);

  it('opens a case when the alert is the only signal', async () => {
    await wire('routing').publish(amlAlert);
    await flush();
    expect(h.createFraudCase).toHaveBeenCalled();
    expect(h.createFraudCase.mock.calls[0][3]).toContain('aml.alert: high');
  });

  it('recalls the payout while the rail has not taken it', async () => {
    await wire('routing').publish(amlAlert);
    await flush();
    expect(h.releasePendingCredit).toHaveBeenCalled();
    expect(h.emitProcessEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ processAction: 'payout.withheld' }));
  });

  it('records that an in-flight payout cannot be recalled instead of inventing a reversal', async () => {
    await wire('in_flight').publish(amlAlert);
    await flush();
    expect(h.releasePendingCredit).not.toHaveBeenCalled();
    expect(h.emitProcessEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ processAction: 'payout.recall.not.possible' }));
  });

  it('does nothing on a clear AML result', async () => {
    const bus = wire('routing');
    await bus.publish(makeEvent({
      eventType: 'aml.monitoring.completed', correlationId: TXN, businessProcess: 'fraud_investigation' as const,
      payload: { transactionId: TXN, outcome: 'clear', alert: false },
    }));
    await flush();
    expect(h.createFraudCase).not.toHaveBeenCalled();
    expect(h.releasePendingCredit).not.toHaveBeenCalled();
  });
});

describe('4. a held RTP approval follows the investigation outcome', () => {
  function wire(status: string) {
    const db = {
      collection: () => ({ findOne: vi.fn(async () => ({ paymentRequestInstanceReference: 'req-1', status, amount: 50, currency: 'EUR', requesterPartyReference: 'p-2' })) }),
    } as unknown as Db;
    const bus = new EventBusInProcess();
    new RtpLifecycleProcess(db, bus, 0).register();
    return bus;
  }
  const holdEvent = (action: string) => makeEvent({
    eventType: action, correlationId: 'exec-1', businessProcess: 'payment_processing' as const,
    payload: { executionRef: 'exec-1', outcome: 'approved' },
  });

  beforeEach(clearMocks);

  it('cleared: the accepted request moves to payment_initiated', async () => {
    await wire('accepted').publish(holdEvent('transfer.hold.released'));
    await flush();
    expect(h.transitionRequest).toHaveBeenCalledWith(expect.anything(), 'req-1', 'payment_initiated', expect.anything());
  });

  it('confirmed fraud: the accepted request ends as payment_failed', async () => {
    await wire('accepted').publish(holdEvent('transfer.hold.reversed'));
    await flush();
    expect(h.transitionRequest).toHaveBeenCalledWith(expect.anything(), 'req-1', 'payment_failed', expect.anything());
  });

  it('ignores a release for a request that was never held', async () => {
    await wire('payment_settled').publish(holdEvent('transfer.hold.released'));
    await flush();
    expect(h.transitionRequest).not.toHaveBeenCalled();
  });
});

// PR #116 review: the case severity must mirror the alert. Mapping every non-high/critical alert to
// `medium` inflated a low alert and lost the distinction the analyst triages by.
describe('an AML case carries the severity of its alert', () => {
  function wire() {
    const db = {
      collection: (name: string) => ({
        findOne: vi.fn(async () => (name === 'fraudDiagnosisCase' ? null : { cardTransactionInstanceReference: TXN, cardTransactionAmount: { amount: 100, currency: 'USD' } })),
        updateOne: vi.fn(async () => ({ matchedCount: 1 })),
      }),
    } as unknown as Db;
    const bus = new EventBusInProcess();
    new PostAuthorizationProcess(db, bus).register();
    return bus;
  }
  const alert = (severity?: string) => makeEvent({
    eventType: 'aml.monitoring.completed', correlationId: TXN, businessProcess: 'fraud_investigation' as const,
    payload: { transactionId: TXN, outcome: 'alert', alert: true, ...(severity ? { severity } : {}) },
  });

  beforeEach(clearMocks);

  it.each([
    ['critical', 'critical'],
    ['high', 'high'],
    ['medium', 'medium'],
    ['low', 'low'],
  ])('maps a %s alert to a %s case', async (severity, expected) => {
    await wire().publish(alert(severity));
    await flush();
    expect(h.createFraudCase).toHaveBeenCalled();
    expect(h.createFraudCase.mock.calls[0][4]).toBe(expected);
  });

  it('falls back to medium for an absent or unknown severity', async () => {
    await wire().publish(alert(undefined));
    await flush();
    expect(h.createFraudCase.mock.calls[0][4]).toBe('medium');
    clearMocks();
    await wire().publish(alert('spicy'));
    await flush();
    expect(h.createFraudCase.mock.calls[0][4]).toBe('medium');
  });
});

/**
 * Unit tests (ADR-060): a risk signal HOLDS a money movement, it never rejects it.
 *  - screenTransfer reports a hold (not a block) for fraud / sanctions / severe AML;
 *  - submitHeldTransfer releases a cleared transfer to the rail;
 *  - reverseHeldTransfer returns the held funds and never delivers them;
 *  - both refuse anything that is not a `pending` execution carrying the risk-hold step.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  dispatchProvider: vi.fn(),
  emitProcessEvent: vi.fn(),
  emitComplianceEvent: vi.fn(),
  releaseReservation: vi.fn(async () => true),
  transitionExecution: vi.fn(async () => true),
  appendResolutionStep: vi.fn(async () => {}),
  createFraudCase: vi.fn(async () => ({ fraudDiagnosisInstanceReference: 'case-1' })),
}));
vi.mock('../../../../backend/src/modules/provider/services/integrationDispatch.service', () => ({ dispatchProvider: h.dispatchProvider }));
vi.mock('../../../../backend/src/modules/provider/services/businessProcessEvent.service', () => ({
  emitProcessEvent: h.emitProcessEvent, emitComplianceEvent: h.emitComplianceEvent,
}));
vi.mock('../../../../backend/src/modules/gateway/services/payoutAccountBalance.service', () => ({
  releaseReservation: h.releaseReservation, holdAvailableFunds: vi.fn(async () => true),
  settleReservedDebit: vi.fn(), creditAvailable: vi.fn(), creditDirect: vi.fn(), releasePendingCredit: vi.fn(),
}));
vi.mock('../../../../backend/src/modules/gateway/services/paymentExecution.service', () => ({
  transitionExecution: h.transitionExecution, appendResolutionStep: h.appendResolutionStep,
}));
vi.mock('../../../../backend/src/modules/fraud/services/fraudDiagnosis.service', () => ({ createFraudCase: h.createFraudCase }));

import type { Db } from 'mongodb';
import { screenTransfer } from '../../../../backend/src/modules/gateway/services/transferRiskGate';
import {
  RISK_HOLD_STEP, getHeldExecution, submitHeldTransfer, reverseHeldTransfer,
} from '../../../../backend/src/modules/gateway/services/transferReview.service';

const EXEC = 'exec-1';

// FDS/HRP/AML verdicts are all served through dispatchProvider; key off the event type.
function providerVerdicts(v: { fds?: Record<string, unknown>; hrp?: Record<string, unknown>; aml?: Record<string, unknown> }) {
  h.dispatchProvider.mockImplementation(async (_db: unknown, _type: unknown, event: string) => {
    if (event === 'fds.scoring.requested') return { provider: 'internal', status: 'received', responseBody: v.fds ?? {} };
    if (event === 'hrp.screening.requested') return { provider: 'internal', status: 'received', responseBody: v.hrp ?? {} };
    if (event === 'aml.monitoring.requested') return { provider: 'internal', status: 'received', responseBody: v.aml ?? {} };
    return { provider: 'internal', status: 'received', responseBody: {} };
  });
}

const execDoc = (over: Record<string, unknown> = {}) => ({
  paymentExecutionInstanceReference: EXEC,
  paymentExecutionStatus: 'pending',
  paymentExecutionRail: 'sepa',
  grossAmount: 900, netAmount: 900, currency: 'EUR',
  sourcePayoutAccountReference: 'acc-sender',
  resolutionLog: [{ stepName: RISK_HOLD_STEP, stepOutcome: 'fallback', stepDateTime: new Date() }],
  ...over,
});

const dbWith = (doc: unknown): Db => ({
  collection: () => ({ findOne: vi.fn(async () => doc) }),
} as unknown as Db);

describe('screenTransfer: a risk signal is a hold, not a block', () => {
  beforeEach(() => { h.dispatchProvider.mockReset(); });
  const input = { transferRef: 't-1', amount: 900, currency: 'EUR', initiatorPartyRef: 'p-1' };

  it('holds on an FDS review recommendation (over the configured threshold)', async () => {
    providerVerdicts({ fds: { riskScore: 100, recommendation: 'review', fraudFlag: true } });
    const r = await screenTransfer({} as Db, input);
    expect(r.hold).toBe(true);
    expect(r.indicators.some((i) => i.startsWith('fds'))).toBe(true);
  });

  it('holds on a sanctions match', async () => {
    providerVerdicts({ hrp: { hrpcMatch: true } });
    const r = await screenTransfer({} as Db, input);
    expect(r.hold).toBe(true);
    expect(r.indicators).toContain('hrp.sanctions.match');
  });

  // ADR-061: any AML alert holds. Before, a low alert let the transfer reach the rail and was only
  // reviewed afterwards, so the money was gone while the case was open.
  it('holds on an AML alert of any severity', async () => {
    for (const severity of ['critical', 'high', 'medium', 'low']) {
      providerVerdicts({ aml: { alert: true, severity } });
      expect((await screenTransfer({} as Db, input)).hold, severity).toBe(true);
    }
  });

  it('does not hold a clean transfer', async () => {
    providerVerdicts({ fds: { riskScore: 10, recommendation: 'approve', fraudFlag: false } });
    const r = await screenTransfer({} as Db, input);
    expect(r.hold).toBe(false);
    expect(r.reason).toBeUndefined();
  });
});

describe('the held transfer is only movable through a resolution', () => {
  beforeEach(() => { for (const fn of Object.values(h)) (fn as { mockReset?: () => void }).mockReset?.(); });

  it('recognises a held execution', async () => {
    expect(await getHeldExecution(dbWith(execDoc()), EXEC)).not.toBeNull();
  });

  it('refuses an execution without the risk-hold step', async () => {
    const db = dbWith(execDoc({ resolutionLog: [{ stepName: 'p2p.initiated', stepOutcome: 'found', stepDateTime: new Date() }] }));
    expect(await getHeldExecution(db, EXEC)).toBeNull();
    expect(await submitHeldTransfer(db, EXEC)).toBe(false);
    expect(await reverseHeldTransfer(db, EXEC)).toBe(false);
    expect(h.dispatchProvider).not.toHaveBeenCalled();
    expect(h.releaseReservation).not.toHaveBeenCalled();
  });

  it('refuses an execution that is no longer pending (the findOne filter excludes it)', async () => {
    const db = dbWith(null);
    expect(await submitHeldTransfer(db, EXEC)).toBe(false);
    expect(await reverseHeldTransfer(db, EXEC)).toBe(false);
  });

  it('cleared: dispatches to the rail and moves the execution in flight', async () => {
    h.dispatchProvider.mockResolvedValue({ provider: 'internal', status: 'received' });
    expect(await submitHeldTransfer(dbWith(execDoc()), EXEC)).toBe(true);
    expect(h.dispatchProvider).toHaveBeenCalledWith(
      expect.anything(), 'payment_initiation', 'provider.payment_initiation.transfer.requested',
      expect.objectContaining({ paymentExecutionInstanceReference: EXEC, amount: 900, currency: 'EUR', railType: 'sepa' }),
      expect.anything(),
    );
    expect(h.transitionExecution).toHaveBeenCalledWith(expect.anything(), EXEC, 'in_flight', undefined);
  });

  it('cleared but the rail refuses: the execution fails instead of silently staying held', async () => {
    h.dispatchProvider.mockResolvedValue({ provider: 'internal', status: 'error' });
    expect(await submitHeldTransfer(dbWith(execDoc()), EXEC)).toBe(false);
    expect(h.transitionExecution).toHaveBeenCalledWith(expect.anything(), EXEC, 'failed', expect.objectContaining({ failureReason: expect.stringContaining('error') }));
  });

  it('confirmed fraud: returns the held funds, reverses the execution, dispatches nothing', async () => {
    expect(await reverseHeldTransfer(dbWith(execDoc()), EXEC)).toBe(true);
    expect(h.releaseReservation).toHaveBeenCalledWith(expect.anything(), 'acc-sender', 900);
    expect(h.transitionExecution).toHaveBeenCalledWith(expect.anything(), EXEC, 'reversed', expect.anything());
    expect(h.dispatchProvider).not.toHaveBeenCalled();
  });

  it('confirmed fraud on a transfer with no internal source account: nothing to return', async () => {
    expect(await reverseHeldTransfer(dbWith(execDoc({ sourcePayoutAccountReference: undefined })), EXEC)).toBe(true);
    expect(h.releaseReservation).not.toHaveBeenCalled();
  });
});


/**
 * PR #116 review: an RTP case stores the REQUEST reference, because the case is opened at screening
 * time, before the approval creates the execution (which gets a fresh UUID and is linked back on the
 * request). Resolving such a case must still reach the held execution, or the request stays `accepted`
 * with the funds held forever.
 */
describe('a resolution reaches the held execution of an RTP request', () => {
  const REQUEST = 'req-1';

  // The reference resolves either directly (an execution) or through the request link.
  const dbFor = (docs: { execution?: unknown; request?: unknown }): Db => ({
    collection: (name: string) => ({
      findOne: vi.fn(async (filter: Record<string, unknown>) => {
        if (name === 'paymentRequestProcedure') return docs.request ?? null;
        // The execution lookup is keyed by reference: only answer for the linked execution id.
        return filter.paymentExecutionInstanceReference === EXEC ? (docs.execution ?? null) : null;
      }),
    }),
  } as unknown as Db);

  beforeEach(() => { for (const fn of Object.values(h)) (fn as { mockReset?: () => void }).mockReset?.(); });

  it('resolves the request reference to its linked execution', async () => {
    const db = dbFor({ execution: execDoc(), request: { linkedPaymentExecutionReference: EXEC } });
    const exec = await getHeldExecution(db, REQUEST);
    expect(exec?.paymentExecutionInstanceReference).toBe(EXEC);
  });

  it('cleared: submits the linked execution, not the request reference', async () => {
    h.dispatchProvider.mockResolvedValue({ provider: 'internal', status: 'received' });
    const db = dbFor({ execution: execDoc(), request: { linkedPaymentExecutionReference: EXEC } });
    expect(await submitHeldTransfer(db, REQUEST)).toBe(true);
    expect(h.dispatchProvider).toHaveBeenCalledWith(
      expect.anything(), 'payment_initiation', 'provider.payment_initiation.transfer.requested',
      expect.objectContaining({ paymentExecutionInstanceReference: EXEC }),
      expect.anything(),
    );
    expect(h.transitionExecution).toHaveBeenCalledWith(expect.anything(), EXEC, 'in_flight', undefined);
  });

  it('confirmed fraud: returns the funds of the linked execution', async () => {
    const db = dbFor({ execution: execDoc(), request: { linkedPaymentExecutionReference: EXEC } });
    expect(await reverseHeldTransfer(db, REQUEST)).toBe(true);
    expect(h.releaseReservation).toHaveBeenCalledWith(expect.anything(), 'acc-sender', 900);
    expect(h.transitionExecution).toHaveBeenCalledWith(expect.anything(), EXEC, 'reversed', expect.anything());
  });

  it('does nothing when the request has no linked execution yet', async () => {
    const db = dbFor({ execution: execDoc(), request: { linkedPaymentExecutionReference: undefined } });
    expect(await getHeldExecution(db, REQUEST)).toBeNull();
    expect(await submitHeldTransfer(db, REQUEST)).toBe(false);
    expect(h.dispatchProvider).not.toHaveBeenCalled();
  });
});

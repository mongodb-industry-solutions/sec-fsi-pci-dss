// Risk hold for money movements (ADR-060). A transfer flagged by the risk gate is ACCEPTED but not
// delivered: the execution stays in `pending` with a `risk.hold` step, the sender funds stay held, and
// nothing reaches the payout rail until L1/L2 resolve the investigation. Resolution then either submits
// the held transfer (cleared) or returns the funds (confirmed fraud). Shared by the bank-transfer, P2P
// and RTP flows, and driven by PayoutOrchestrationProcess on fraud.case.resolved.

import { Db } from 'mongodb';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';
import { PAYMENT_REQUEST_COLLECTION } from '../models/paymentRequest.model';
import { transitionExecution, appendResolutionStep } from './paymentExecution.service';
import { releaseReservation } from './payoutAccountBalance.service';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { emitProcessEvent, emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';

export const RISK_HOLD_STEP = 'risk.hold';

// The held execution, if this reference is one. Guards every resolution path: only a `pending`
// execution carrying the hold step is resumable, so a settled or reversed transfer is never touched.
//
// The reference may also be an RTP request: a fraud case opened at RTP screening time stores the
// REQUEST reference (the execution does not exist yet at that point), so resolve through
// `linkedPaymentExecutionReference` to reach the execution the approval later created.
export async function getHeldExecution(db: Db, reference: string): Promise<PaymentExecutionProcedure | null> {
  const byRef = async (ref: string) => {
    const exec = await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION)
      .findOne({ paymentExecutionInstanceReference: ref, paymentExecutionStatus: 'pending' });
    if (!exec) return null;
    return exec.resolutionLog?.some((s) => s.stepName === RISK_HOLD_STEP) ? exec : null;
  };

  const direct = await byRef(reference);
  if (direct) return direct;

  const request = await db.collection<{ linkedPaymentExecutionReference?: string }>(PAYMENT_REQUEST_COLLECTION)
    .findOne({ paymentRequestInstanceReference: reference }, { projection: { linkedPaymentExecutionReference: 1 } })
    .catch(() => null);
  const linked = request?.linkedPaymentExecutionReference;
  return linked ? byRef(linked) : null;
}

// Cleared: submit the held transfer to the payout rail. Settlement then arrives asynchronously as
// bank.transfer.settled/failed, exactly as it would have at initiation time.
export async function submitHeldTransfer(db: Db, reference: string): Promise<boolean> {
  const exec = await getHeldExecution(db, reference);
  if (!exec) return false;
  // Always act on the resolved execution: `reference` may have been an RTP request.
  const executionRef = exec.paymentExecutionInstanceReference;

  const dispatch = await dispatchProvider(
    db,
    'payment_initiation',
    'provider.payment_initiation.transfer.requested',
    {
      clientReference: executionRef,
      paymentExecutionInstanceReference: executionRef,
      railType: exec.paymentExecutionRail,
      amount: exec.grossAmount ?? exec.netAmount,
      currency: exec.currency,
      settlementSchedule: 'T+1',
      paymentReference: exec.paymentExecutionRemittanceInformation ?? 'Transfer released after review',
    },
    { entityType: 'execution', entityId: executionRef, processType: 'payment_processing' },
  );
  const submitted = dispatch.status === 'sent' || dispatch.status === 'received';

  await transitionExecution(db, executionRef, submitted ? 'in_flight' : 'failed',
    submitted ? undefined : { failureReason: `PISP dispatch ${dispatch.status} after review` });
  await appendResolutionStep(db, executionRef, {
    stepName: 'risk.hold.released',
    stepOutcome: submitted ? 'found' : 'failed',
    stepNote: `investigation cleared; provider=${dispatch.provider} status=${dispatch.status}`,
  });

  emitProcessEvent(db, {
    entityType: 'execution', entityId: executionRef,
    processType: 'payment_processing', processAction: 'transfer.hold.released',
    processOutcome: submitted ? 'approved' : 'rejected',
    performedByPartyReference: null, performedByRole: null,
    eventSummary: { executionRef, amount: exec.grossAmount ?? exec.netAmount, currency: exec.currency, rail: exec.paymentExecutionRail },
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
  });
  return submitted;
}

// Confirmed fraud: the movement never completes. Any sender hold goes back (pending -> available) and
// the execution is reversed (rolled back before settlement), never refunded.
export async function reverseHeldTransfer(db: Db, reference: string): Promise<boolean> {
  const exec = await getHeldExecution(db, reference);
  if (!exec) return false;
  const executionRef = exec.paymentExecutionInstanceReference;

  const amount = exec.grossAmount ?? exec.netAmount ?? 0;
  if (exec.sourcePayoutAccountReference && amount > 0) {
    try { await releaseReservation(db, exec.sourcePayoutAccountReference, amount); }
    catch (err) { console.error('[transfer-review] releaseReservation failed:', err); }
  }

  await transitionExecution(db, executionRef, 'reversed', { failureReason: 'Confirmed fraud on investigation' });
  await appendResolutionStep(db, executionRef, {
    stepName: 'risk.hold.reversed', stepOutcome: 'failed', stepNote: 'investigation confirmed fraud; funds returned',
  });

  emitComplianceEvent(db, {
    entityType: 'execution', entityId: executionRef,
    processType: 'payment_processing', processAction: 'transfer.hold.reversed',
    processOutcome: 'rejected',
    performedByPartyReference: null, performedByRole: null,
    eventSummary: { executionRef, amount, currency: exec.currency, returnedToAccount: exec.sourcePayoutAccountReference ?? null },
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
  });
  return true;
}

// v28 RTP approval (in-app, authenticated payer; NO CIBA). Reuses the balance-aware P2P sequence:
// funds check (AIS) → screening (FDS/HRP/AML + VoP) → hold → create SD-65 execution → dispatch
// payment_initiation. Settlement (bank.transfer.settled/failed) is applied by PayoutOrchestrationProcess
// (settleCardDebit + creditDirect), and projected back onto the request by RtpLifecycleProcess (F5).
// The PSP holds no accounts and moves no money directly; every settlement is delegated to providers.
import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { getPayoutAccount, getDefaultPayoutAccount } from './payoutAccount.service';
import { holdCardFunds, releaseCardHold } from './payoutAccountBalance.service';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { emitProcessEvent, emitComplianceEvent, EventActivityAttribution } from '../../provider/services/businessProcessEvent.service';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';
import { PAYMENT_REQUEST_COLLECTION, PaymentRequestProcedure } from '../models/paymentRequest.model';
import { getRtpRequest, transitionRequest, RtpError } from './rtpRequest.service';
import { screenRtpRequest } from './rtpScreening.service';
import { createNotification, markReadByRelated } from '../../notification/notifications.service';

export interface ApproveRtpInput {
  actor: string;                 // payer partyRef (authenticated)
  role?: string;
  fundingAccountRef?: string;    // payer-chosen; else default active account
  deviceUserAgent?: string;
  authMethod?: 'session_jwt' | 'oauth_session';
  attribution?: EventActivityAttribution;
}

export interface ApproveRtpResult {
  status: 'accepted' | 'blocked' | 'failed';
  request: PaymentRequestProcedure;
  executionReference?: string;
  reason?: string;
}

const BIAN_SD = 'Payment Order';
const BIAN_CR = 'PaymentRequestProcedure';

export async function approveRtpRequest(db: Db, ref: string, input: ApproveRtpInput): Promise<ApproveRtpResult> {
  const req = await getRtpRequest(db, ref);
  if (!req) throw new RtpError('not_found', 'Payment request not found', 404);
  if (!req.payerPartyReference) throw new RtpError('no_payer', 'Request has no resolved payer', 422);
  if (req.payerPartyReference !== input.actor) throw new RtpError('not_payer', 'Only the payer may approve this request', 403);
  if (!['presented', 'delivered', 'viewed'].includes(req.status)) {
    throw new RtpError('invalid_state', `Request cannot be approved from status ${req.status}`, 409);
  }

  // FR-v28-12: payer must have an active payout account to approve.
  const funding = input.fundingAccountRef
    ? await getPayoutAccount(db, input.fundingAccountRef)
    : await getDefaultPayoutAccount(db, req.payerPartyReference);
  if (!funding || funding.payoutAccountStatus !== 'active' || funding.partyInstanceReference !== req.payerPartyReference) {
    throw new RtpError('no_funding_account', 'Payer has no active funding account to approve this request', 422);
  }

  const reqWithFunding = { ...req, payerFundingAccountReference: funding.payoutAccountInstanceReference } as PaymentRequestProcedure;

  // 1. Funds sufficiency (AIS). Advisory; the conditional hold below is the hard guard.
  try {
    await dispatchProvider(db, 'account_information', 'funds.check.requested', {
      payoutAccountInstanceReference: funding.payoutAccountInstanceReference, amount: req.amount, currency: req.currency,
    }, { entityType: 'payment_request', entityId: ref, processType: 'payment_processing' });
  } catch { /* advisory */ }

  // 2. Screening (FDS/HRP/AML + VoP). Block/hold → keep the request presented, record decisions.
  const screen = await screenRtpRequest(db, reqWithFunding);
  if (screen.blocked) {
    await db.collection<PaymentRequestProcedure>(PAYMENT_REQUEST_COLLECTION).updateOne(
      { paymentRequestInstanceReference: ref },
      { $set: { policyDecisions: screen.decisions, riskFlags: screen.indicators, payerFundingAccountReference: funding.payoutAccountInstanceReference, recordUpdatedDateTime: new Date() } },
    );
    emitComplianceEvent(db, {
      entityType: 'payment_request', entityId: ref, processType: 'payment_processing',
      processAction: 'rtp.request.screening.blocked', processOutcome: 'rejected',
      performedByPartyReference: input.actor, performedByRole: input.role ?? 'customer',
      eventSummary: { indicators: screen.indicators, score: screen.score, vop: screen.vop.matchResult },
      bianServiceDomain: BIAN_SD, bianControlRecordType: BIAN_CR, attribution: input.attribution,
    });
    if (req.payerPartyReference) await createNotification(db, {
      recipientPartyReference: req.payerPartyReference, notificationType: 'payment_request',
      title: 'Payment request held for review',
      detail: screen.reason ?? 'The request was held by security screening.',
      href: `/system/transfer?request=${ref}`, relatedReference: ref, actionable: true,
    });
    const current = await getRtpRequest(db, ref);
    return { status: 'blocked', request: current!, reason: screen.reason };
  }

  // 3. Hold payer funds (available -> pending), conditional on sufficient available balance.
  const held = await holdCardFunds(db, funding.payoutAccountInstanceReference, req.amount);
  if (!held) throw new RtpError('insufficient_funds', 'Insufficient available balance to approve this request', 422);

  // 4. Create the SD-65 execution (source = payer, resolved = payee). sourcePayoutAccountReference
  //    marks the P2P settlement path so PayoutOrchestrationProcess settles/credits both accounts.
  const executionRef = uuidv4();
  const now = new Date();
  const rail = funding.payoutAccountPreferredRail;
  const execution: PaymentExecutionProcedure = {
    paymentExecutionInstanceReference: executionRef,
    paymentOrderInstanceReference: executionRef,
    beneficiaryType: 'user',
    initiatorPartyReference: req.payerPartyReference,
    beneficiaryPartyReference: req.requesterPartyReference,
    sourcePayoutAccountReference: funding.payoutAccountInstanceReference,
    resolvedPayoutAccountReference: req.payeeReceivingAccountReference,
    grossAmount: req.amount, netAmount: req.amount, feeAmount: 0, currency: req.currency,
    paymentExecutionRail: rail,
    routingNote: `RTP approval for request ${ref}`,
    ...(req.purpose ? { paymentExecutionRemittanceInformation: req.purpose } : {}),
    paymentExecutionStatus: 'routing',
    initiatedAt: now,
    resolutionLog: [{ stepName: 'rtp.approved', stepOutcome: 'found', stepNote: `request=${ref}`, stepDateTime: now }],
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
    recordCreatedDateTime: now, recordUpdatedDateTime: now, schemaVersion: 1,
  };
  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).insertOne(execution);

  // 5. Dispatch through payment_initiation (ADR-039). Settlement arrives async as bank.transfer.settled/failed.
  const dispatch = await dispatchProvider(db, 'payment_initiation', 'provider.payment_initiation.transfer.requested', {
    clientReference: executionRef, paymentExecutionInstanceReference: executionRef,
    railType: rail, amount: req.amount, currency: req.currency, settlementSchedule: 'T+1',
    paymentReference: req.purpose ?? 'Request to Pay',
  }, { entityType: 'execution', entityId: executionRef, processType: 'payment_processing' });
  const submitted = dispatch.status === 'sent' || dispatch.status === 'received';

  if (!submitted) {
    await releaseCardHold(db, funding.payoutAccountInstanceReference, req.amount); // compensation
    await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).updateOne(
      { paymentExecutionInstanceReference: executionRef },
      { $set: { paymentExecutionStatus: 'failed', failureReason: `PISP dispatch ${dispatch.status}`, recordUpdatedDateTime: new Date() } },
    );
    const current = await getRtpRequest(db, ref);
    return { status: 'failed', request: current!, executionReference: executionRef, reason: 'Could not submit to the payment rail.' };
  }
  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).updateOne(
    { paymentExecutionInstanceReference: executionRef },
    { $set: { paymentExecutionStatus: 'in_flight', recordUpdatedDateTime: new Date() } },
  );

  // 6. Transition the request: accepted → payment_initiated. Persist authorizationContext (immutable),
  //    the linked execution reference, chosen funding account and policy decisions.
  await transitionRequest(db, ref, 'accepted', {
    action: 'rtp.request.accepted', actor: input.actor, role: input.role, outcome: 'approved',
    attribution: input.attribution, summary: 'RTP approved in-app by payer',
    set: {
      authorizationContext: {
        authMethod: input.authMethod ?? 'session_jwt', subject: input.actor, channel: 'in_app',
        deviceUserAgent: input.deviceUserAgent, authenticatedAt: new Date(), authResult: 'approved',
      },
      payerFundingAccountReference: funding.payoutAccountInstanceReference,
      policyDecisions: screen.decisions,
    },
  });
  const updated = await transitionRequest(db, ref, 'payment_initiated', {
    action: 'rtp.payment.initiated', actor: input.actor, role: input.role, outcome: 'submitted',
    summary: 'Linked payment execution created', meta: { executionReference: executionRef },
    set: { linkedPaymentExecutionReference: executionRef },
    attribution: input.attribution,
  });

  // Clear the payer's pending-approval alert; notify the payee the request was approved.
  if (req.payerPartyReference) await markReadByRelated(db, req.payerPartyReference, ref);
  await createNotification(db, {
    recipientPartyReference: req.requesterPartyReference, notificationType: 'payment_request',
    title: 'Your payment request was approved',
    detail: `Your request for ${req.amount} ${req.currency} was approved and payment is on the way`,
    href: `/system/transfer?request=${ref}`, relatedReference: ref, actionable: false,
  });

  emitProcessEvent(db, {
    entityType: 'payment_request', entityId: ref, processType: 'payment_processing',
    processAction: 'rtp.request.accepted', processOutcome: 'approved',
    performedByPartyReference: input.actor, performedByRole: input.role ?? 'customer',
    eventSummary: { amount: req.amount, currency: req.currency, executionReference: executionRef },
    bianServiceDomain: BIAN_SD, bianControlRecordType: BIAN_CR, attribution: input.attribution,
  });

  return { status: 'accepted', request: updated, executionReference: executionRef };
}

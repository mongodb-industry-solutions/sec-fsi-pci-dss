// BIAN SD-65/66: P2P (peer-to-peer) bank transfer to a saved beneficiary.
// v17.1 (ADR-039/040): a beneficiary transfer is an EXTERNAL bank transfer, not an internal
// ledger move. Execution is dispatched through the payment_initiation provider (never a direct
// builtin import). Funds are held on the sender at submission (available -> pending) and the
// recipient is credited only when the provider emits bank.transfer.settled (async, T+N),
// handled by PayoutOrchestrationProcess. On failure the hold is released.
// PCI DSS Req 10: every transfer creates an immutable paymentExecutionProcedure audit record.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COUNTERPARTY_COLLECTION, CounterpartyArrangement } from '../../identity/models/counterpartyArrangement.model';
import { getPayoutAccount, getDefaultPayoutAccount } from './payoutAccount.service';
import { holdCardFunds, releaseCardHold } from './payoutAccountBalance.service';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../models/payoutAccount.model';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';
import { emitProcessEvent, emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';

export interface P2PTransferInput {
  initiatorPartyRef: string;         // the customer initiating the transfer
  counterpartyArrangementRef: string; // beneficiary token
  fromAccountRef: string;            // sender's payout account
  amount: number;
  note?: string;
}

export interface P2PTransferResult {
  transferReference: string;
  amount: number;
  currency: string;
  status: 'submitted' | 'completed' | 'failed';
  failureReason?: string;
  recipientAccountRef?: string;
  recipientHint?: string;
}

function fail(amount: number, currency: string, reason: string): P2PTransferResult {
  return { transferReference: '', amount, currency, status: 'failed', failureReason: reason };
}

export async function executeP2PTransfer(
  db: Db,
  input: P2PTransferInput,
): Promise<P2PTransferResult> {
  const { initiatorPartyRef, counterpartyArrangementRef, fromAccountRef, amount } = input;

  if (amount <= 0) return fail(amount, '', 'Amount must be greater than zero.');

  // 1. Verify the beneficiary arrangement exists, is active, and belongs to the initiator
  const arrangement = await db
    .collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION)
    .findOne({ counterpartyArrangementReference: counterpartyArrangementRef, ownerPartyReference: initiatorPartyRef, counterpartyArrangementStatus: 'active' });
  if (!arrangement) return fail(amount, '', 'Beneficiary not found or no longer active.');

  // 2. Verify the sender's account belongs to the initiator and is active
  const senderAccount = await getPayoutAccount(db, fromAccountRef);
  if (!senderAccount || senderAccount.partyInstanceReference !== initiatorPartyRef || senderAccount.payoutAccountStatus !== 'active') {
    return fail(amount, '', 'Source account not found or not active.');
  }
  // Currency is always the sender account's native currency (server-authoritative — client hint is ignored).
  const transferCurrency = senderAccount.payoutAccountCurrency;

  // 3. Resolve the recipient's payout account — currency-matched active default, then any active
  const recipientPartyRef = arrangement.counterpartyPartyReference;
  let recipientAccount: PayoutAccountArrangement | null = await db
    .collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
    .findOne({ partyInstanceReference: recipientPartyRef, payoutAccountCurrency: transferCurrency, payoutAccountStatus: 'active', payoutAccountIsDefault: true });
  if (!recipientAccount) {
    recipientAccount = await db
      .collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
      .findOne({ partyInstanceReference: recipientPartyRef, payoutAccountCurrency: transferCurrency, payoutAccountStatus: 'active' });
  }
  if (!recipientAccount) {
    recipientAccount = await getDefaultPayoutAccount(db, recipientPartyRef)
      ?? await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
          .findOne({ partyInstanceReference: recipientPartyRef, payoutAccountStatus: 'active' });
  }
  if (!recipientAccount) return fail(amount, transferCurrency, 'Recipient has no active payout account.');

  // 4. Hold sender funds (available -> pending), conditional on sufficient available balance.
  const held = await holdCardFunds(db, fromAccountRef, amount);
  if (!held) return fail(amount, transferCurrency, 'Insufficient available balance.');

  // 5. Create the immutable SD-65 execution in routing state. sourcePayoutAccountReference marks this
  //    as a P2P transfer so the settlement handler clears the sender hold and credits the recipient.
  const transferRef = uuidv4();
  const now = new Date();
  const rail = recipientAccount.payoutAccountPreferredRail ?? senderAccount.payoutAccountPreferredRail;
  const execution: PaymentExecutionProcedure = {
    paymentExecutionInstanceReference: transferRef,
    paymentOrderInstanceReference: transferRef,
    beneficiaryType: 'user',
    initiatorPartyReference: initiatorPartyRef,
    beneficiaryPartyReference: recipientPartyRef,
    sourcePayoutAccountReference: fromAccountRef,
    resolvedPayoutAccountReference: recipientAccount.payoutAccountInstanceReference,
    grossAmount: amount,
    netAmount: amount,
    feeAmount: 0,
    currency: transferCurrency,
    paymentExecutionRail: rail,
    routingNote: input.note ? `P2P transfer note: ${input.note}` : 'P2P transfer via beneficiary portal',
    paymentExecutionStatus: 'routing',
    initiatedAt: now,
    resolutionLog: [
      { stepName: 'p2p.initiated', stepOutcome: 'found', stepNote: `beneficiary=${counterpartyArrangementRef}`, stepDateTime: now },
    ],
    bianServiceDomain: 'Payment Execution',
    bianControlRecordType: 'PaymentExecutionProcedure',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };
  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).insertOne(execution);

  // 6. Dispatch the transfer through the payment_initiation provider (ADR-039). Settlement arrives
  //    asynchronously as bank.transfer.settled/failed and is applied by PayoutOrchestrationProcess.
  const dispatch = await dispatchProvider(
    db,
    'payment_initiation',
    'provider.payment_initiation.transfer.requested',
    {
      clientReference: transferRef,
      paymentExecutionInstanceReference: transferRef,
      railType: rail,
      amount,
      currency: transferCurrency,
      settlementSchedule: 'T+1',
      paymentReference: input.note ?? 'P2P transfer',
    },
    { entityType: 'execution', entityId: transferRef, processType: 'payment_processing' },
  );
  const submitted = dispatch.status === 'sent' || dispatch.status === 'received';

  if (!submitted) {
    // Compensate: release the hold so funds never vanish, mark the execution failed.
    await releaseCardHold(db, fromAccountRef, amount);
    await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).updateOne(
      { paymentExecutionInstanceReference: transferRef },
      { $set: { paymentExecutionStatus: 'failed', failureReason: `PISP dispatch ${dispatch.status}`, recordUpdatedDateTime: new Date() } },
    );
    return fail(amount, transferCurrency, 'Transfer could not be submitted.');
  }

  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).updateOne(
    { paymentExecutionInstanceReference: transferRef },
    {
      $set: { paymentExecutionStatus: 'in_flight', recordUpdatedDateTime: new Date() },
      $push: { resolutionLog: { stepName: 'provider.payment_initiation.transfer', stepOutcome: 'found', stepNote: `provider=${dispatch.provider} rail=${rail}`, stepDateTime: new Date() } },
    },
  );

  // EDA: notify compliance subscribers (P2PComplianceProcess → FDS + HRP + AML) at submission.
  void (async () => {
    const { getEventBus, makeEvent } = await import('../../../vendors/eventbus');
    void getEventBus().publish(makeEvent({
      eventType: 'p2p.transfer.completed',
      correlationId: transferRef,
      businessProcess: 'payment_processing',
      source: 'psp.p2p',
      payload: { transferRef, amount, currency: transferCurrency, initiatorPartyRef, sourceAccountRef: fromAccountRef, recipientAccountRef: recipientAccount.payoutAccountInstanceReference },
      bian: { serviceDomain: 'Payment Execution', controlRecord: 'PaymentExecutionProcedure' },
    }));
  })();

  // EDA: business + compliance audit (submitted). Correlated by the execution reference.
  emitProcessEvent(db, {
    entityType: 'execution', entityId: transferRef,
    processType: 'payment_processing', processAction: 'bank.transfer.submitted',
    processOutcome: 'in_flight',
    performedByPartyReference: initiatorPartyRef, performedByRole: 'customer',
    eventSummary: {
      amount, currency: transferCurrency, fromAccount: fromAccountRef,
      toAccount: recipientAccount.payoutAccountInstanceReference,
      beneficiaryArrangement: counterpartyArrangementRef, beneficiaryLabel: arrangement.counterpartyLabel, rail,
    },
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
  });
  emitComplianceEvent(db, {
    entityType: 'execution', entityId: transferRef,
    processType: 'payment_processing', processAction: 'bank.transfer.funds.held',
    processOutcome: 'in_flight',
    performedByPartyReference: initiatorPartyRef, performedByRole: 'customer',
    eventSummary: { grossAmount: amount, currency: transferCurrency, debitAccount: fromAccountRef, creditAccount: recipientAccount.payoutAccountInstanceReference, beneficiaryType: 'user' },
    bianServiceDomain: 'Payment Execution', bianControlRecordType: 'PaymentExecutionProcedure',
  });

  return {
    transferReference: transferRef,
    amount,
    currency: transferCurrency,
    status: 'submitted',
    recipientAccountRef: recipientAccount.payoutAccountInstanceReference,
    recipientHint: arrangement.counterpartyLabel,
  };
}

// BIAN SD-65: P2P (peer-to-peer) payment execution — direct payout-account-to-payout-account transfer.
// Triggered from the beneficiary portal when a customer sends money to a saved contact.
// PCI DSS Req 10: every transfer creates an immutable paymentExecutionProcedure audit record.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { COUNTERPARTY_COLLECTION, CounterpartyArrangement } from '../../identity/models/counterpartyArrangement.model';
import { getPayoutAccount, getDefaultPayoutAccount } from './payoutAccount.service';
import { debitAvailable, creditDirect } from './payoutAccountBalance.service';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../models/payoutAccount.model';
import { emitProcessEvent, emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';

export interface P2PTransferInput {
  initiatorPartyRef: string;         // the customer initiating the transfer
  counterpartyArrangementRef: string; // beneficiary token
  fromAccountRef: string;            // sender's payout account
  amount: number;
  currency: string;
  note?: string;
}

export interface P2PTransferResult {
  transferReference: string;
  amount: number;
  currency: string;
  status: 'completed' | 'failed';
  failureReason?: string;
  recipientAccountRef?: string;
  recipientHint?: string;
}

export async function executeP2PTransfer(
  db: Db,
  input: P2PTransferInput,
): Promise<P2PTransferResult> {
  const { initiatorPartyRef, counterpartyArrangementRef, fromAccountRef, amount, currency } = input;

  if (amount <= 0) {
    return { transferReference: '', amount, currency, status: 'failed', failureReason: 'Amount must be greater than zero.' };
  }

  // 1. Verify the beneficiary arrangement exists, is active, and belongs to the initiator
  const arrangement = await db
    .collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION)
    .findOne({ counterpartyArrangementReference: counterpartyArrangementRef, ownerPartyReference: initiatorPartyRef, counterpartyArrangementStatus: 'active' });

  if (!arrangement) {
    return { transferReference: '', amount, currency, status: 'failed', failureReason: 'Beneficiary not found or no longer active.' };
  }

  // 2. Verify the sender's account belongs to the initiator and is active
  const senderAccount = await getPayoutAccount(db, fromAccountRef);
  if (!senderAccount || senderAccount.partyInstanceReference !== initiatorPartyRef || senderAccount.payoutAccountStatus !== 'active') {
    return { transferReference: '', amount, currency, status: 'failed', failureReason: 'Source account not found or not active.' };
  }
  // Currency is always the sender account's native currency (server-authoritative — client hint is ignored).
  const transferCurrency = senderAccount.payoutAccountCurrency;

  // 3. Find the recipient's payout account — prefer currency-matched active account, fall back to any active account
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
    // Fall back to any active account regardless of currency (demo: cross-currency)
    recipientAccount = await getDefaultPayoutAccount(db, recipientPartyRef)
      ?? await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
          .findOne({ partyInstanceReference: recipientPartyRef, payoutAccountStatus: 'active' });
  }

  if (!recipientAccount) {
    return { transferReference: '', amount, currency: transferCurrency, status: 'failed', failureReason: 'Recipient has no active payout account.' };
  }

  // 4. Debit sender — conditional on sufficient available balance
  const debited = await debitAvailable(db, fromAccountRef, amount);
  if (!debited) {
    return { transferReference: '', amount, currency: transferCurrency, status: 'failed', failureReason: 'Insufficient available balance.' };
  }

  // 5. Credit recipient — in the recipient account's currency (FX when cross-currency). Atomic
  //    consistency: if the credit fails, revert the sender debit so funds never vanish in flight.
  let creditAmount = amount;
  if (recipientAccount.payoutAccountCurrency && recipientAccount.payoutAccountCurrency !== transferCurrency) {
    const { resolveAndConvert } = await import('../../../providers/currency-exchange/services/currencyExchange.service');
    try { creditAmount = (await resolveAndConvert(db, amount, transferCurrency, recipientAccount.payoutAccountCurrency)).amount; }
    catch { await creditDirect(db, fromAccountRef, amount); return { transferReference: '', amount, currency: transferCurrency, status: 'failed', failureReason: `No FX rate for ${transferCurrency}->${recipientAccount.payoutAccountCurrency}.` }; }
  }
  const credited = await creditDirect(db, recipientAccount.payoutAccountInstanceReference, creditAmount);
  if (!credited) {
    // Compensate: return the debited funds to the sender (recipient account not creditable).
    await creditDirect(db, fromAccountRef, amount);
    return { transferReference: '', amount, currency: transferCurrency, status: 'failed', failureReason: 'Recipient account could not be credited.' };
  }

  // 6. Create immutable paymentExecutionProcedure audit record (PCI DSS Req 10)
  const transferRef = uuidv4();
  const now = new Date();
  const execution: PaymentExecutionProcedure = {
    paymentExecutionInstanceReference: transferRef,
    paymentOrderInstanceReference: transferRef, // direct P2P: no separate order record
    beneficiaryType: 'user',
    initiatorPartyReference: initiatorPartyRef,
    beneficiaryPartyReference: recipientPartyRef,
    sourcePayoutAccountReference: fromAccountRef,
    resolvedPayoutAccountReference: recipientAccount.payoutAccountInstanceReference,
    grossAmount: amount,
    netAmount: amount,
    feeAmount: 0,
    currency: transferCurrency,
    paymentExecutionRail: senderAccount.payoutAccountPreferredRail ?? 'internal_ledger',
    routingNote: input.note ? `P2P transfer note: ${input.note}` : 'P2P transfer via beneficiary portal',
    paymentExecutionStatus: 'completed',
    completedAt: now,
    initiatedAt: now,
    resolutionLog: [
      {
        stepName: 'p2p_initiated',
        stepOutcome: 'found',
        stepNote: `Initiator: ${initiatorPartyRef} · Beneficiary token: ${counterpartyArrangementRef}`,
        stepDateTime: now,
      },
      {
        stepName: 'p2p_executed',
        stepOutcome: 'found',
        stepNote: `Debit: ${fromAccountRef} · Credit: ${recipientAccount.payoutAccountInstanceReference}`,
        stepDateTime: now,
      },
    ],
    bianServiceDomain: 'Payment Execution',
    bianControlRecordType: 'PaymentExecutionProcedure',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };
  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).insertOne(execution);

  // EDA: notify compliance subscribers (P2PComplianceProcess → FDS + HRP + AML)
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

  // EDA: business process event (payment_processing journey — visible in audit events / system log)
  emitProcessEvent(db, {
    entityType: 'p2p_transfer',
    entityId: transferRef,
    processType: 'payment_processing',
    processAction: 'p2p.transfer.executed',
    processOutcome: 'approved',
    performedByPartyReference: initiatorPartyRef,
    performedByRole: 'customer',
    eventSummary: {
      amount, currency: transferCurrency,
      fromAccount: fromAccountRef,
      toAccount: recipientAccount.payoutAccountInstanceReference,
      beneficiaryArrangement: counterpartyArrangementRef,
      beneficiaryLabel: arrangement.counterpartyLabel,
      rail: senderAccount.payoutAccountPreferredRail ?? 'internal_ledger',
    },
    bianServiceDomain: 'Payment Execution',
    bianControlRecordType: 'PaymentExecutionProcedure',
  });

  // PCI DSS Req 10: compliance audit record for every fund movement
  emitComplianceEvent(db, {
    entityType: 'p2p_transfer',
    entityId: transferRef,
    processType: 'payment_processing',
    processAction: 'p2p.transfer.funds.moved',
    processOutcome: 'approved',
    performedByPartyReference: initiatorPartyRef,
    performedByRole: 'customer',
    eventSummary: {
      grossAmount: amount, currency: transferCurrency,
      debitAccount: fromAccountRef,
      creditAccount: recipientAccount.payoutAccountInstanceReference,
      beneficiaryType: 'user',
    },
    bianServiceDomain: 'Payment Execution',
    bianControlRecordType: 'PaymentExecutionProcedure',
  });

  return {
    transferReference: transferRef,
    amount,
    currency: transferCurrency,
    status: 'completed',
    recipientAccountRef: recipientAccount.payoutAccountInstanceReference,
    recipientHint: arrangement.counterpartyLabel,
  };
}

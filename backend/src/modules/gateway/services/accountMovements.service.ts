// BIAN SD-66 / SD-65 / SD-254: unified account movement aggregation service
// Merges paymentExecutionProcedure (disbursements) and cardTransactionLog (card activity)
// into a single AccountMovement ledger view for a given payout account.

import { Db } from 'mongodb';
import { AccountMovement, MovementType, MovementDirection } from '../models/accountMovement.model';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';
import { PAYMENT_CARD_COLLECTION, PaymentCardManagementControlRecord } from '../../customer/models/paymentCard.model';
import { CARD_TRANSACTION_COLLECTION, CardTransactionLogControlRecord } from '../../transaction/models/cardTransaction.model';

export interface ListMovementsOptions {
  type?: MovementType;
  direction?: MovementDirection;
  from?: string; // ISO date
  to?: string;
  page?: number;
  limit?: number;
}

export async function listAccountMovements(
  db: Db,
  accountRef: string,
  opts: ListMovementsOptions = {}
): Promise<{ movements: AccountMovement[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));

  // 1. Fetch payout disbursements + P2P movements from paymentExecutionProcedure
  const executionCol = db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION);

  const toIso = (d: Date | string): string =>
    d instanceof Date ? d.toISOString() : new Date(d).toISOString();

  // 1a. Merchant/non-P2P disbursements — this account receives the payout (credit)
  const merchantExecs = await executionCol.find({
    resolvedPayoutAccountReference: accountRef,
    beneficiaryType: { $ne: 'user' },
  }).toArray();

  // 1b. P2P received — this account is the recipient of a user-to-user transfer (credit)
  const p2pReceivedExecs = await executionCol.find({
    resolvedPayoutAccountReference: accountRef,
    beneficiaryType: 'user',
  }).toArray();

  // 1c. P2P sent — this account is the source of a user-to-user transfer (debit)
  const p2pSentExecs = await executionCol.find({
    sourcePayoutAccountReference: accountRef,
    beneficiaryType: 'user',
  }).toArray();

  const disbursements: AccountMovement[] = [
    ...merchantExecs.map((exec) => ({
      movementId: exec.paymentExecutionInstanceReference,
      movementType: 'payout_disbursement' as MovementType,
      direction: 'credit' as MovementDirection,
      amount: exec.netAmount,
      currency: exec.currency,
      description: 'Payout disbursement',
      counterpartyRef: exec.resolvedPayoutAccountReference,
      status: exec.paymentExecutionStatus,
      occurredAt: toIso(exec.recordCreatedDateTime),
      sourceCollection: PAYMENT_EXECUTION_COLLECTION,
      sourceRef: exec.paymentExecutionInstanceReference,
    })),
    ...p2pReceivedExecs.map((exec) => ({
      movementId: exec.paymentExecutionInstanceReference,
      movementType: 'p2p_received' as MovementType,
      direction: 'credit' as MovementDirection,
      amount: exec.netAmount,
      currency: exec.currency,
      description: exec.routingNote ?? 'P2P transfer received',
      counterpartyRef: exec.sourcePayoutAccountReference,
      status: exec.paymentExecutionStatus,
      occurredAt: toIso(exec.recordCreatedDateTime),
      sourceCollection: PAYMENT_EXECUTION_COLLECTION,
      sourceRef: exec.paymentExecutionInstanceReference,
    })),
    ...p2pSentExecs.map((exec) => ({
      movementId: exec.paymentExecutionInstanceReference,
      movementType: 'p2p_sent' as MovementType,
      direction: 'debit' as MovementDirection,
      amount: exec.netAmount,
      currency: exec.currency,
      description: exec.routingNote ?? 'P2P transfer sent',
      counterpartyRef: exec.resolvedPayoutAccountReference,
      status: exec.paymentExecutionStatus,
      occurredAt: toIso(exec.recordCreatedDateTime),
      sourceCollection: PAYMENT_EXECUTION_COLLECTION,
      sourceRef: exec.paymentExecutionInstanceReference,
    })),
  ];

  // 2. Get all cards linked to this payout account
  const cardCol = db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION);
  const cards = await cardCol.find({
    fundingPayoutAccountInstanceReference: accountRef,
  }).toArray();

  const cardIds = cards.map((c) => c.paymentCardInstanceReference);

  // 3. Fetch card transactions for those cards
  let cardMovements: AccountMovement[] = [];
  if (cardIds.length > 0) {
    const txCol = db.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION);
    const transactions = await txCol.find({
      paymentCardReference: { $in: cardIds },
    }).toArray();

    cardMovements = transactions.map((tx) => {
      const isRefund = tx.cardTransactionType === 'refund';
      return {
        movementId: tx.cardTransactionInstanceReference,
        movementType: (isRefund ? 'card_refund' : 'card_debit') as MovementType,
        direction: (isRefund ? 'credit' : 'debit') as MovementDirection,
        amount: tx.cardTransactionAmount.amount,
        currency: tx.cardTransactionAmount.currency,
        description: tx.cardTransactionDescription ?? (isRefund ? 'Card refund' : 'Card payment'),
        counterpartyName: tx.cardTransactionMerchantName,
        counterpartyRef: tx.merchantAgreementInstanceReference,
        status: tx.cardTransactionStatus,
        occurredAt: tx.cardTransactionDateTime instanceof Date
          ? tx.cardTransactionDateTime.toISOString()
          : new Date(tx.cardTransactionDateTime).toISOString(),
        sourceCollection: CARD_TRANSACTION_COLLECTION,
        sourceRef: tx.cardTransactionInstanceReference,
      };
    });
  }

  // 4. Merge all movements
  let all: AccountMovement[] = [...disbursements, ...cardMovements];

  // 5. Apply type/direction filters in-memory
  if (opts.type) {
    all = all.filter((m) => m.movementType === opts.type);
  }
  if (opts.direction) {
    all = all.filter((m) => m.direction === opts.direction);
  }

  // 6. Apply date filters
  if (opts.from) {
    const fromTs = new Date(opts.from).getTime();
    all = all.filter((m) => new Date(m.occurredAt).getTime() >= fromTs);
  }
  if (opts.to) {
    const toTs = new Date(opts.to).getTime();
    all = all.filter((m) => new Date(m.occurredAt).getTime() <= toTs);
  }

  // 7. Sort by occurredAt DESC
  all.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  // 8. Pagination
  const total = all.length;
  const skip = (page - 1) * limit;
  const movements = all.slice(skip, skip + limit);

  return { movements, total };
}

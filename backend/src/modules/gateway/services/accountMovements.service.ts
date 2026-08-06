// unified account movement aggregation service
// Merges paymentExecutionProcedure (disbursements) and cardTransactionLog (card activity)
// into a single AccountMovement ledger view for a given payout account.

import { Db } from 'mongodb';
import { AccountMovement, MovementType, MovementDirection } from '../models/accountMovement.model';
import { PAYMENT_EXECUTION_COLLECTION, PaymentExecutionProcedure } from '../models/paymentExecution.model';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../models/payoutAccount.model';
import { PAYMENT_CARD_COLLECTION, PaymentCardManagementControlRecord } from '../../customer/models/paymentCard.model';
import { CARD_TRANSACTION_COLLECTION, CardTransactionLogControlRecord } from '../../transaction/models/cardTransaction.model';
import { BALANCE_CREDIT_LOG_COLLECTION, BalanceCreditLogEntry } from '../models/balanceCreditLog.model';

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

  // 1a. Merchant/non-P2P disbursements: this account receives the payout (credit)
  const merchantExecs = await executionCol.find({
    resolvedPayoutAccountReference: accountRef,
    beneficiaryType: { $ne: 'user' },
  }).toArray();

  // 1b. P2P received: this account is the recipient of a user-to-user transfer (credit)
  const p2pReceivedExecs = await executionCol.find({
    resolvedPayoutAccountReference: accountRef,
    beneficiaryType: 'user',
  }).toArray();

  // 1c. P2P sent: this account is the source of a user-to-user transfer (debit)
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

  // 3b. Balance credit log entries (initial deposits, bank-in transfers, admin credits)
  const creditLogEntries = await db.collection<BalanceCreditLogEntry>(BALANCE_CREDIT_LOG_COLLECTION)
    .find({ payoutAccountInstanceReference: accountRef }).toArray();
  const creditMovements: AccountMovement[] = creditLogEntries.map((c) => ({
    movementId: c.creditId,
    movementType: 'balance_credit' as MovementType,
    direction: 'credit' as MovementDirection,
    amount: c.amount,
    currency: c.currency,
    description: c.description,
    status: 'settled',
    occurredAt: c.creditedAt instanceof Date ? c.creditedAt.toISOString() : new Date(c.creditedAt).toISOString(),
    sourceCollection: BALANCE_CREDIT_LOG_COLLECTION,
    sourceRef: c.creditId,
  }));

  // 4. Merge all movements
  let all: AccountMovement[] = [...disbursements, ...cardMovements, ...creditMovements];

  // 4b. Running available balance: per settled movement, "balance after this movement".
  //
  //     Only movements that actually SETTLED (funds moved) affect the available balance.
  //     A failed/exception/reversed transfer or a still-pending card authorisation never
  //     debited the ledger, so it must not shift the running balance (otherwise e.g. a
  //     rejected transfer would appear to have moved money). Non-settled rows still show
  //     in the ledger for audit, but carry no balanceAfter.
  //
  //     We ANCHOR to the account's current stored availableAmount and walk BACKWARDS: the
  //     newest settled movement's balanceAfter equals the current balance; each older row is
  //     the balance before the newer one settled. This keeps the ledger consistent with the
  //     authoritative stored balance even if historical execution records are incomplete or
  //     were reseeded independently: rather than reconstructing forward from zero.
  const SETTLED_STATUSES = new Set(['completed', 'settled']);
  const isSettled = (m: AccountMovement): boolean =>
    m.movementType === 'balance_credit' || SETTLED_STATUSES.has(m.status);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const account = await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
    .findOne({ payoutAccountInstanceReference: accountRef }, { projection: { payoutAccountBalance: 1 } });
  const currentAvailable = account?.payoutAccountBalance?.availableAmount ?? 0;

  // Newest → oldest over settled movements only.
  const settledDesc = all
    .filter(isSettled)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  let balanceAfter = currentAvailable;
  for (const m of settledDesc) {
    m.balanceAfter = round2(balanceAfter);
    // Undo this movement's effect to get the balance that preceded it (= balanceAfter of the next older row).
    balanceAfter = balanceAfter - (m.direction === 'credit' ? m.amount : -m.amount);
  }

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

// BIAN SD-66: Payout Account Balance — atomic balance operations
// All mutations use MongoDB $inc — never read-modify-write. PCI DSS Req 10.

import { Db } from 'mongodb';
import { PAYOUT_ACCOUNT_COLLECTION } from '../models/payoutAccount.model';

/**
 * Increment pendingAmount when a card transaction is authorized.
 * Called by PayoutOrchestrationProcess on payout.orchestration.triggered.
 */
export async function debitPending(
  db: Db,
  payoutAccountRef: string,
  amount: number,
): Promise<boolean> {
  const result = await db.collection(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    { payoutAccountInstanceReference: payoutAccountRef, payoutAccountStatus: 'active' },
    {
      $inc: { 'payoutAccountBalance.pendingAmount': amount },
      $set: { 'payoutAccountBalance.lastUpdatedDateTime': new Date(), recordUpdatedDateTime: new Date() },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Move amount from pending to available when settlement is confirmed.
 * Called by PayoutOrchestrationProcess on bank.transfer.settled.
 */
export async function creditAvailable(
  db: Db,
  payoutAccountRef: string,
  amount: number,
): Promise<boolean> {
  const result = await db.collection(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    { payoutAccountInstanceReference: payoutAccountRef, payoutAccountStatus: 'active' },
    {
      $inc: {
        'payoutAccountBalance.pendingAmount': -amount,
        'payoutAccountBalance.availableAmount': amount,
      },
      $set: { 'payoutAccountBalance.lastUpdatedDateTime': new Date(), recordUpdatedDateTime: new Date() },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Reserve funds for a dispute hold (debit available, credit reserved).
 */
export async function reserveFunds(
  db: Db,
  payoutAccountRef: string,
  amount: number,
): Promise<boolean> {
  const result = await db.collection(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    { payoutAccountInstanceReference: payoutAccountRef, payoutAccountStatus: 'active' },
    {
      $inc: {
        'payoutAccountBalance.availableAmount': -amount,
        'payoutAccountBalance.reservedAmount': amount,
      },
      $set: { 'payoutAccountBalance.lastUpdatedDateTime': new Date(), recordUpdatedDateTime: new Date() },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Debit the available balance directly (P2P transfer debit side).
 * Conditional on having sufficient available balance — returns false if insufficient funds.
 */
export async function debitAvailable(
  db: Db,
  payoutAccountRef: string,
  amount: number,
): Promise<boolean> {
  const result = await db.collection(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    {
      payoutAccountInstanceReference: payoutAccountRef,
      payoutAccountStatus: 'active',
      'payoutAccountBalance.availableAmount': { $gte: amount },
    },
    {
      $inc: { 'payoutAccountBalance.availableAmount': -amount },
      $set: { 'payoutAccountBalance.lastUpdatedDateTime': new Date(), recordUpdatedDateTime: new Date() },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Credit the available balance directly (P2P transfer credit side).
 */
export async function creditDirect(
  db: Db,
  payoutAccountRef: string,
  amount: number,
): Promise<boolean> {
  const result = await db.collection(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    { payoutAccountInstanceReference: payoutAccountRef, payoutAccountStatus: 'active' },
    {
      $inc: { 'payoutAccountBalance.availableAmount': amount },
      $set: { 'payoutAccountBalance.lastUpdatedDateTime': new Date(), recordUpdatedDateTime: new Date() },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Hold funds on card authorization (cardholder / issuer perspective).
 * Moves amount from availableAmount → pendingAmount atomically.
 * Conditional on sufficient available balance — returns false if insufficient.
 * PCI DSS Req 3: no SAD stored; operates only on PSP-internal UUID references.
 */
export async function holdCardFunds(
  db: Db,
  payoutAccountRef: string,
  amount: number,
): Promise<boolean> {
  const result = await db.collection(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    {
      payoutAccountInstanceReference: payoutAccountRef,
      payoutAccountStatus: 'active',
      'payoutAccountBalance.availableAmount': { $gte: amount },
    },
    {
      $inc: {
        'payoutAccountBalance.availableAmount': -amount,
        'payoutAccountBalance.pendingAmount': amount,
      },
      $set: { 'payoutAccountBalance.lastUpdatedDateTime': new Date(), recordUpdatedDateTime: new Date() },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Clear the pending hold when a card purchase settles.
 * Decrements pendingAmount only — available was already reduced at auth time.
 */
export async function settleCardDebit(
  db: Db,
  payoutAccountRef: string,
  amount: number,
): Promise<boolean> {
  const result = await db.collection(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    { payoutAccountInstanceReference: payoutAccountRef, payoutAccountStatus: 'active' },
    {
      $inc: { 'payoutAccountBalance.pendingAmount': -amount },
      $set: { 'payoutAccountBalance.lastUpdatedDateTime': new Date(), recordUpdatedDateTime: new Date() },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Release a card authorization hold back to available (compensation when a later gate declines the
 * journey after funds were already held). Inverse of holdCardFunds: pending -= amount, available += amount.
 * Idempotent-safe at the amount level; callers must only release an amount they actually held.
 */
export async function releaseCardHold(
  db: Db,
  payoutAccountRef: string,
  amount: number,
): Promise<boolean> {
  const result = await db.collection(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    { payoutAccountInstanceReference: payoutAccountRef, payoutAccountStatus: 'active' },
    {
      $inc: {
        'payoutAccountBalance.pendingAmount': -amount,
        'payoutAccountBalance.availableAmount': amount,
      },
      $set: { 'payoutAccountBalance.lastUpdatedDateTime': new Date(), recordUpdatedDateTime: new Date() },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Release reserved funds back to available (e.g., dispute resolved in merchant's favour).
 */
export async function releaseFunds(
  db: Db,
  payoutAccountRef: string,
  amount: number,
): Promise<boolean> {
  const result = await db.collection(PAYOUT_ACCOUNT_COLLECTION).updateOne(
    { payoutAccountInstanceReference: payoutAccountRef, payoutAccountStatus: 'active' },
    {
      $inc: {
        'payoutAccountBalance.reservedAmount': -amount,
        'payoutAccountBalance.availableAmount': amount,
      },
      $set: { 'payoutAccountBalance.lastUpdatedDateTime': new Date(), recordUpdatedDateTime: new Date() },
    },
  );
  return result.modifiedCount === 1;
}

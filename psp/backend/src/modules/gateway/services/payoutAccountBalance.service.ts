// Payout Account Balance, atomic balance operations
// All mutations use MongoDB $inc, never read-modify-write. PCI DSS.

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
 * Drop an expected incoming credit that will never arrive: the exact inverse of debitPending.
 * Used when a payout is rejected before or by the rail (beneficiary validation failed, submission
 * refused, rail returned the transfer).
 *
 * pendingAmount -= amount and availableAmount is deliberately NOT credited: the funds never landed,
 * so crediting them would invent money. That is what separates this from releaseReservation, which
 * returns a SENDER's own funds. Leaving the amount in pending instead would show the beneficiary an
 * incoming credit that can never settle.
 */
export async function releasePendingCredit(
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
 * Conditional on having sufficient available balance: returns false if insufficient funds.
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
 * Moves amount from availableAmount → pendingAmount atomically, conditional on sufficient available
 * balance: returns false if insufficient. No SAD stored; operates only on PSP-internal UUID references.
 *
 * **Renamed from `holdCardFunds` in v37 P5.4, because the old name asserted something untrue of most of its
 * callers.** A card authorisation IS a pre-authorisation at the issuer. On SEPA and ACH there is no such
 * thing: a hold there is the PSP reserving against its own record so a customer cannot spend the same money
 * twice while a transfer is in flight, and once the ledger lives at the bank it has **no accounting effect
 * at all** (the bank holds the money; this only moves a projection). Calling it a card hold implied a
 * guarantee the rail does not give.
 */
export async function holdAvailableFunds(
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
 * Decrements pendingAmount only: available was already reduced at auth time.
 */
export async function settleReservedDebit(
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
 * journey after funds were already held). Inverse of reserveFunds: pending -= amount, available += amount.
 * Idempotent-safe at the amount level; callers must only release an amount they actually held.
 */
export async function releaseReservation(
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

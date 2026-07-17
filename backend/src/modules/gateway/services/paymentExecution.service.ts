// BIAN SD-65: Payment Execution Procedure service
// State machine transitions for settlement lifecycle.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  PAYMENT_EXECUTION_COLLECTION,
  PaymentExecutionProcedure,
  PaymentExecutionStatus,
  PaymentExecutionResolutionStep,
  BeneficiaryType,
} from '../models/paymentExecution.model';
import type { PayoutRail } from '../models/payoutAccount.model';
import {
  MERCHANT_AGREEMENT_COLLECTION,
  MerchantAgreementControlRecord,
} from '../models/merchantAgreement.model';
import type { PaymentExecutionFee } from '../models/paymentExecution.model';

export interface CreateExecutionInput {
  paymentOrderInstanceReference: string;
  cardTransactionInstanceReference?: string;
  beneficiaryType: BeneficiaryType;
  beneficiaryPartyReference?: string;
  resolvedPayoutAccountReference?: string;
  grossAmount: number;
  netAmount: number;
  feeAmount?: number;
  currency: string;
  paymentExecutionRail?: PayoutRail;
}

// ── v18: merchant-commission fee (SD-65 attribution / SD-89 pricing) ───────────

// DRY, single place to derive a commission fee. Rounds to 2 decimals (currency minor unit for the demo
// currencies). rate is 0..1; a missing/invalid rate yields a zero fee. Returns both the numeric amount
// (stored in feeAmount) and the attribution sub-doc (stored in fee).
export function computeFee(
  amount: number,
  rate: number | undefined,
  currency: string,
  merchantReference: string,
): { feeAmount: number; feeCurrency: string; fee: PaymentExecutionFee } {
  const safeRate = typeof rate === 'number' && rate > 0 && rate <= 1 ? rate : 0;
  const feeAmount = Math.round(amount * safeRate * 100) / 100;
  return {
    feeAmount,
    feeCurrency: currency,
    fee: {
      feeMerchantReference: merchantReference,
      feeRateApplied: safeRate,
      feeCollectedDateTime: new Date(),
    },
  };
}

// Apply the merchant's CURRENT commission rate (SD-89) to a finalized execution (SD-65) and persist
// feeAmount + fee attribution. Idempotent: skips if a fee is already attributed to this merchant.
export async function applyMerchantFee(
  db: Db,
  executionRef: string,
  merchantReference: string,
): Promise<PaymentExecutionFee | null> {
  const exec = await getExecution(db, executionRef);
  if (!exec) return null;
  if (exec.fee?.feeMerchantReference === merchantReference) return exec.fee; // idempotent
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ merchantAgreementInstanceReference: merchantReference }, { projection: { merchantCommissionRate: 1 } });
  const { feeAmount, fee } = computeFee(exec.grossAmount, merchant?.merchantCommissionRate, exec.currency, merchantReference);
  // Sparse: only fee-bearing executions carry a `fee` sub-document. A zero commission (no rate
  // configured, or rate ≤ 0) attributes nothing — otherwise commission counts/revenue would be
  // inflated by zero-fee executions. Mirrors the acquiring path (applyMerchantCommissionToCardTxn).
  if (feeAmount <= 0) return null;
  // Round netAmount to 2 decimals like feeAmount, so gross − fee cannot leak float artifacts
  // (e.g. 10.1 − 0.3 → 9.799999999) into the persisted balance-affecting figure.
  const netAmount = Math.round((exec.grossAmount - feeAmount) * 100) / 100;
  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).updateOne(
    { paymentExecutionInstanceReference: executionRef },
    { $set: { feeAmount, netAmount, fee, recordUpdatedDateTime: new Date() } },
  );
  return fee;
}

export async function createExecution(
  db: Db,
  input: CreateExecutionInput,
): Promise<PaymentExecutionProcedure> {
  const now = new Date();
  const record: PaymentExecutionProcedure = {
    paymentExecutionInstanceReference: uuidv4(),
    paymentOrderInstanceReference: input.paymentOrderInstanceReference,
    cardTransactionInstanceReference: input.cardTransactionInstanceReference,
    beneficiaryType: input.beneficiaryType,
    beneficiaryPartyReference: input.beneficiaryPartyReference,
    resolvedPayoutAccountReference: input.resolvedPayoutAccountReference,
    grossAmount: input.grossAmount,
    netAmount: input.netAmount,
    feeAmount: input.feeAmount ?? 0,
    currency: input.currency,
    paymentExecutionRail: input.paymentExecutionRail,
    paymentExecutionStatus: 'routing',
    resolutionLog: [],
    bianServiceDomain: 'Payment Execution',
    bianControlRecordType: 'PaymentExecutionProcedure',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };
  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).insertOne(record);
  return record;
}

export async function transitionExecution(
  db: Db,
  executionRef: string,
  newStatus: PaymentExecutionStatus,
  patch?: Partial<Pick<PaymentExecutionProcedure, 'routingNote' | 'failureReason' | 'scheduledAt' | 'initiatedAt' | 'completedAt' | 'paymentExecutionRail' | 'resolvedPayoutAccountReference'>>,
): Promise<boolean> {
  const result = await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).updateOne(
    { paymentExecutionInstanceReference: executionRef },
    {
      $set: {
        paymentExecutionStatus: newStatus,
        recordUpdatedDateTime: new Date(),
        ...(patch ?? {}),
      },
    },
  );
  return result.modifiedCount === 1;
}

export async function appendResolutionStep(
  db: Db,
  executionRef: string,
  step: Omit<PaymentExecutionResolutionStep, 'stepDateTime'>,
): Promise<void> {
  await db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION).updateOne(
    { paymentExecutionInstanceReference: executionRef },
    {
      $push: { resolutionLog: { ...step, stepDateTime: new Date() } as PaymentExecutionResolutionStep },
      $set: { recordUpdatedDateTime: new Date() },
    },
  );
}

export async function getExecution(
  db: Db,
  executionRef: string,
): Promise<PaymentExecutionProcedure | null> {
  return db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION)
    .findOne({ paymentExecutionInstanceReference: executionRef });
}

// List a party's SD-65 executions (both sent and received), most recent first, capped. Used by the
// staff customer-transactions view to aggregate the party's money movement alongside card txns.
// Party references are plaintext business keys (not CHD/PII), so no QE decrypt is needed for the read.
export async function listPartyExecutions(
  db: Db,
  partyRef: string,
  cap = 200,
): Promise<PaymentExecutionProcedure[]> {
  if (!partyRef) return [];
  return db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION)
    .find({ $or: [{ initiatorPartyReference: partyRef }, { beneficiaryPartyReference: partyRef }] })
    .sort({ initiatedAt: -1 })
    .limit(cap)
    .toArray();
}

export async function listExecutions(
  db: Db,
  opts?: { status?: PaymentExecutionStatus; page?: number; limit?: number },
): Promise<{ results: PaymentExecutionProcedure[]; total: number }> {
  const query: Record<string, unknown> = {};
  if (opts?.status) query.paymentExecutionStatus = opts.status;

  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;

  const col = db.collection<PaymentExecutionProcedure>(PAYMENT_EXECUTION_COLLECTION);
  const [results, total] = await Promise.all([
    col.find(query).sort({ recordCreatedDateTime: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(query),
  ]);
  return { results, total };
}

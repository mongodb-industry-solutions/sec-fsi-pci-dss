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

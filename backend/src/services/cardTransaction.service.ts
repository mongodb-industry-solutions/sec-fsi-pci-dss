import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  CARD_TRANSACTION_COLLECTION,
  CARD_TRANSACTION_SENSITIVE_COLLECTION,
  CardTransactionLogControlRecord,
  CardTransactionSensitiveRecord,
} from '../models';
import { createFraudCase } from './fraudDiagnosis.service';

export interface CreateTransactionInput {
  cardToken: string;
  accountReference: string;
  amount: number;
  currency: string;
  merchantName: string;
  merchantCategoryCode: string;
  transactionChannel: string;
  maskedPanDisplay: string;
  gatewayPayload: object;
}

function shouldCreateFraudCase(amount: number, mcc: string): { create: boolean; reasons: string[] } {
  const threshold = parseInt(process.env.FRAUD_AMOUNT_THRESHOLD ?? '500', 10);
  const riskMccList = (process.env.RISK_MCC_LIST ?? '5812,6011,7995').split(',').map((m) => m.trim());
  const reasons: string[] = [];
  if (amount > threshold) reasons.push('amount_threshold');
  if (riskMccList.includes(mcc)) reasons.push('high_risk_mcc');
  return { create: reasons.length > 0, reasons };
}

function deriveSeverity(amount: number, riskIndicators: string[]): 'low' | 'medium' | 'high' | 'critical' {
  if (amount > 1000 || riskIndicators.length >= 2) return 'critical';
  if (amount > 500) return 'high';
  if (amount > 200) return 'medium';
  return 'low';
}

export async function createTransaction(db: Db, input: CreateTransactionInput) {
  const txnId = uuidv4();
  const now = new Date();

  const txn: Omit<CardTransactionLogControlRecord, never> = {
    cardTransactionInstanceReference: txnId,
    paymentCardReference: input.cardToken,
    cardTransactionAccountReference: input.accountReference,
    transactionAmount: { amount: input.amount, currency: input.currency },
    transactionDateTime: now,
    transactionStatus: 'authorized',
    transactionChannel: input.transactionChannel as CardTransactionLogControlRecord['transactionChannel'],
    cardTransactionInitiationType: 'customerInitiated',
    merchantCategoryCode: input.merchantCategoryCode,
    merchantName: input.merchantName,
    maskedPanDisplay: input.maskedPanDisplay,
    bianServiceDomain: 'CardTransaction',
    bianControlRecordType: 'CardTransactionLog',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
  };

  const sensitive: CardTransactionSensitiveRecord = {
    cardTransactionInstanceReference: txnId,
    rawGatewayPayload: input.gatewayPayload,
    processorTransactionMetadata: { processedAt: now.toISOString() },
  };

  await db.collection(CARD_TRANSACTION_COLLECTION).insertOne(txn as object);
  await db.collection(CARD_TRANSACTION_SENSITIVE_COLLECTION).insertOne(sensitive as object);

  const { create, reasons } = shouldCreateFraudCase(input.amount, input.merchantCategoryCode);
  let fraudCaseRef: string | undefined;

  if (create) {
    const severity = deriveSeverity(input.amount, reasons);
    const fraudCase = await createFraudCase(db, txnId, input.accountReference, reasons, severity);
    fraudCaseRef = fraudCase.fraudDiagnosisInstanceReference;
  }

  return {
    cardTransactionInstanceReference: txnId,
    transactionStatus: 'authorized',
    fraudCaseCreated: create,
    ...(fraudCaseRef && { fraudDiagnosisInstanceReference: fraudCaseRef }),
  };
}

export async function getTransactionById(db: Db, id: string) {
  const txn = await db.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
    .findOne({ cardTransactionInstanceReference: id } as Partial<CardTransactionLogControlRecord>);

  if (!txn) return null;

  // Level 1 response: no QE fields echoed back
  return {
    cardTransactionInstanceReference: txn.cardTransactionInstanceReference,
    transactionAmount: txn.transactionAmount,
    transactionDateTime: txn.transactionDateTime,
    transactionStatus: txn.transactionStatus,
    merchantName: txn.merchantName,
    merchantCategoryCode: txn.merchantCategoryCode,
    maskedPanDisplay: txn.maskedPanDisplay,
    transactionChannel: txn.transactionChannel,
    paymentCardReference: txn.paymentCardReference,
  };
}

export async function getTransactionsByCardToken(db: Db, cardToken: string) {
  const results = await db.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
    .find({ paymentCardReference: cardToken } as Partial<CardTransactionLogControlRecord>)
    .sort({ transactionDateTime: -1 })
    .toArray();

  return { results, count: results.length };
}

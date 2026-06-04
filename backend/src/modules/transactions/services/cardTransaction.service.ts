import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  CARD_TRANSACTION_COLLECTION,
  CARD_TRANSACTION_SENSITIVE_COLLECTION,
  CardTransactionLogControlRecord,
  CardTransactionSensitiveRecord,
} from '../models/cardTransaction.model';
import { createFraudCase } from '../../fraud/services/fraudDiagnosis.service';

export interface CreateTransactionInput {
  cardToken: string;
  accountReference: string;
  amount: number;
  currency: string;
  cardTransactionMerchantName: string;
  cardTransactionMerchantCategoryCode: string;
  cardTransactionChannel: string;
  cardTransactionMaskedPanDisplay: string;
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
    cardTransactionAmount: { amount: input.amount, currency: input.currency },
    cardTransactionDateTime: now,
    cardTransactionStatus: 'authorized',
    cardTransactionChannel: input.cardTransactionChannel as CardTransactionLogControlRecord['cardTransactionChannel'],
    cardTransactionInitiationType: 'customerInitiated',
    cardTransactionMerchantCategoryCode: input.cardTransactionMerchantCategoryCode,
    cardTransactionMerchantName: input.cardTransactionMerchantName,
    cardTransactionMaskedPanDisplay: input.cardTransactionMaskedPanDisplay,
    bianServiceDomain: 'CardTransaction',
    bianControlRecordType: 'CardTransactionLog',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };

  const sensitive: CardTransactionSensitiveRecord = {
    cardTransactionInstanceReference: txnId,
    rawGatewayPayload: input.gatewayPayload,
    processorTransactionMetadata: { processedAt: now.toISOString() },
    schemaVersion: 1,
  };

  await db.collection(CARD_TRANSACTION_COLLECTION).insertOne(txn as object);
  await db.collection(CARD_TRANSACTION_SENSITIVE_COLLECTION).insertOne(sensitive as object);

  const { create, reasons } = shouldCreateFraudCase(input.amount, input.cardTransactionMerchantCategoryCode);
  let fraudCaseRef: string | undefined;

  if (create) {
    const severity = deriveSeverity(input.amount, reasons);
    const snapshot = {
      cardTransactionAmount: { amount: input.amount, currency: input.currency },
      cardTransactionMerchantName: input.cardTransactionMerchantName,
      cardTransactionDateTime: now,
      cardTransactionStatus: 'authorized' as const,
      cardTransactionMaskedPanDisplay: input.cardTransactionMaskedPanDisplay,
    };
    const fraudCase = await createFraudCase(db, txnId, input.accountReference, reasons, severity, snapshot);
    fraudCaseRef = fraudCase.fraudDiagnosisInstanceReference;
  }

  return {
    cardTransactionInstanceReference: txnId,
    cardTransactionStatus: 'authorized',
    fraudCaseCreated: create,
    ...(fraudCaseRef && { fraudDiagnosisInstanceReference: fraudCaseRef }),
  };
}

export async function getTransactionById(db: Db, id: string) {
  const txn = await db.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
    .findOne({ cardTransactionInstanceReference: id } as Partial<CardTransactionLogControlRecord>);

  if (!txn) return null;

  return {
    cardTransactionInstanceReference: txn.cardTransactionInstanceReference,
    cardTransactionAmount: txn.cardTransactionAmount,
    cardTransactionDateTime: txn.cardTransactionDateTime,
    cardTransactionStatus: txn.cardTransactionStatus,
    cardTransactionMerchantName: txn.cardTransactionMerchantName,
    cardTransactionMerchantCategoryCode: txn.cardTransactionMerchantCategoryCode,
    cardTransactionMaskedPanDisplay: txn.cardTransactionMaskedPanDisplay,
    cardTransactionChannel: txn.cardTransactionChannel,
    paymentCardReference: txn.paymentCardReference,
  };
}

/** Returns unique merchant name + MCC pairs from seeded transactions, sorted by name. */
export async function getDistinctMerchants(db: Db) {
  const results = await db
    .collection(CARD_TRANSACTION_COLLECTION)
    .aggregate([
      {
        $group: {
          _id: {
            name: '$cardTransactionMerchantName',
            mcc: '$cardTransactionMerchantCategoryCode',
          },
        },
      },
      { $project: { _id: 0, name: '$_id.name', mcc: '$_id.mcc' } },
      { $sort: { name: 1 } },
    ])
    .toArray();

  return results as { name: string; mcc: string }[];
}

export async function getTransactionsByCardToken(db: Db, cardToken: string) {
  const results = await db.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
    .find({ paymentCardReference: cardToken } as Partial<CardTransactionLogControlRecord>)
    .sort({ cardTransactionDateTime: -1 })
    .toArray();

  return { results, count: results.length };
}

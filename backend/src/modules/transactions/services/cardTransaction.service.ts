import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  CARD_TRANSACTION_COLLECTION,
  CARD_TRANSACTION_SENSITIVE_COLLECTION,
  CardTransactionLogControlRecord,
  CardTransactionSensitiveRecord,
} from '../models/cardTransaction.model';
import { createFraudCase } from '../../fraud/services/fraudDiagnosis.service';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../customer/models/customerAgreement.model';

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

export async function getTransactionById(
  db: Db,
  id: string,
  role: 'level1_analyst' | 'level2_investigator' | 'security_auditor' | 'customer' = 'level1_analyst',
  escalationToken?: string
) {
  const txn = await db.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
    .findOne({ cardTransactionInstanceReference: id } as Partial<CardTransactionLogControlRecord>);

  if (!txn) return null;

  const base = {
    cardTransactionInstanceReference: txn.cardTransactionInstanceReference,
    cardTransactionAmount:            txn.cardTransactionAmount,
    cardTransactionDateTime:          txn.cardTransactionDateTime,
    cardTransactionStatus:            txn.cardTransactionStatus,
    cardTransactionMerchantName:      txn.cardTransactionMerchantName,
    cardTransactionMerchantCategoryCode: txn.cardTransactionMerchantCategoryCode,
    cardTransactionMaskedPanDisplay:  txn.cardTransactionMaskedPanDisplay,
    cardTransactionChannel:           txn.cardTransactionChannel,
    cardTransactionInitiationType:    txn.cardTransactionInitiationType,
    paymentCardReference:             txn.paymentCardReference,
    // QE:equality — decrypted by QE client, available for analyst roles
    cardTransactionAccountReference:  txn.cardTransactionAccountReference,
  };

  // Include sensitive fields for L2 (with escalation token) and Security Auditor
  const { canReadSensitive } = await import('../../../vendors/middleware/rbac');
  const { validateToken }    = await import('../../../vendors/security/escalationTokens');

  const hasValidToken = validateToken(escalationToken).valid;
  if (canReadSensitive(role, hasValidToken)) {
    const sensitive = await db.collection(CARD_TRANSACTION_SENSITIVE_COLLECTION)
      .findOne({ cardTransactionInstanceReference: id });
    return {
      ...base,
      sensitive: sensitive
        ? {
            rawGatewayPayload:            (sensitive as unknown as CardTransactionSensitiveRecord).rawGatewayPayload,
            processorTransactionMetadata: (sensitive as unknown as CardTransactionSensitiveRecord).processorTransactionMetadata,
          }
        : null,
    };
  }

  return base;
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

export async function getAllTransactions(
  db: Db,
  filters: { status?: string; merchant?: string; cardToken?: string; email?: string },
  page: number,
  limit: number
) {
  const query: Record<string, unknown> = {};
  if (filters.status)    query['cardTransactionStatus']       = filters.status;
  if (filters.merchant)  query['cardTransactionMerchantName'] = { $regex: filters.merchant, $options: 'i' };
  if (filters.cardToken) query['paymentCardReference']        = filters.cardToken;

  // Two-step QE search: email → customerAgreementReference → cardTransactions
  // Step 1: QE:equality search on customerAgreement.customerEmailAddress
  // Step 2: QE:equality search on cardTransaction.cardTransactionAccountReference
  if (filters.email) {
    const agreement = await db
      .collection(CUSTOMER_AGREEMENT_COLLECTION)
      .findOne({ customerEmailAddress: filters.email } as Record<string, unknown>);

    if (!agreement) {
      return { results: [], total: 0, page, limit };
    }

    // customerAgreementReference is a QE:equality field — after QE decryption it
    // is the plaintext account reference (e.g. ACC-001). Use it to query transactions.
    const accountRef = (agreement as Record<string, unknown>).customerAgreementReference as string;
    query['cardTransactionAccountReference'] = accountRef;
  }

  const skip = (page - 1) * limit;
  const [results, total] = await Promise.all([
    db.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
      .find(query)
      .sort({ cardTransactionDateTime: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection(CARD_TRANSACTION_COLLECTION).countDocuments(query),
  ]);

  return { results, total, page, limit };
}

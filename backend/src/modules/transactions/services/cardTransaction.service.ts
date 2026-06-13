import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  CARD_TRANSACTION_COLLECTION,
  CardTransactionLogControlRecord,
} from '../models/cardTransaction.model';
import { getDbForRole } from '../../../vendors/encryption/roleClients';
import { createFraudCase } from '../../fraud/services/fraudDiagnosis.service';
import { CUSTOMER_AGREEMENT_COLLECTION } from '../../customer/models/customerAgreement.model';
import { PARTY_COLLECTION, PartyControlRecord } from '../../identity/models/party.model';
import { emitProcessEvent } from '../../integrations/services/businessProcessEvent.service';

export interface CreateTransactionInput {
  cardToken: string;
  accountReference: string;
  amount: number;
  currency: string;
  cardTransactionMerchantName: string;
  cardTransactionMerchantCategoryCode: string;
  cardTransactionChannel: string;
  cardTransactionMaskedPanDisplay: string;
  cardTransactionType: string;
  cardTransactionDescription: string;
  cardTransactionNarrative?: string;
  // Acquiring-side link (SD-89): the merchant this payment was made to. Optional.
  merchantAgreementInstanceReference?: string;
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

/**
 * Resolve a customer's agreement from an account reference that may be either an
 * email (QE:equality on party) or a business key (customerAgreementReference).
 * Returns both the agreement UUID (for fraud-case linkage) and the canonical
 * account reference (ACC-xxx) used to normalize cardTransactionAccountReference.
 */
export async function resolveCustomerAgreement(db: Db, accountReference: string): Promise<{ uuid?: string; reference?: string }> {
  try {
    const l1Db = await getDbForRole('level1_analyst', false);
    let agreement: { customerAgreementInstanceReference?: string; customerAgreementReference?: string } | null = null;
    if (accountReference.includes('@')) {
      const party = await db
        .collection<PartyControlRecord>(PARTY_COLLECTION)
        .findOne({ partyEmailAddress: accountReference } as Partial<PartyControlRecord>);
      if (party?.partyInstanceReference) {
        agreement = await l1Db
          .collection<{ customerAgreementInstanceReference: string; customerAgreementReference: string }>(CUSTOMER_AGREEMENT_COLLECTION)
          .findOne({ partyInstanceReference: party.partyInstanceReference } as Record<string, unknown>);
      }
    } else {
      agreement = await l1Db
        .collection<{ customerAgreementInstanceReference: string; customerAgreementReference: string }>(CUSTOMER_AGREEMENT_COLLECTION)
        .findOne({ customerAgreementReference: accountReference } as Record<string, unknown>);
    }
    return { uuid: agreement?.customerAgreementInstanceReference, reference: agreement?.customerAgreementReference };
  } catch {
    return {};
  }
}

export async function createTransaction(db: Db, input: CreateTransactionInput) {
  const txnId = uuidv4();
  const now = new Date();

  // v2: sensitive gateway fields (QE:none, DEK-sensitive tier) are written inline.
  // Use the Level 2 QE client so the driver encrypts them with the correct DEKs.
  const txWriteDb = await getDbForRole('security_auditor', false);

  // Normalize the account reference to the customer's canonical business key
  // (ACC-xxx) so seeded and simulator-created transactions share one convention.
  // Falls back to the raw input (e.g. email) if the customer can't be resolved.
  const resolved = await resolveCustomerAgreement(db, input.accountReference);
  const canonicalAccountRef = resolved.reference ?? input.accountReference;

  const txn: CardTransactionLogControlRecord = {
    cardTransactionInstanceReference: txnId,
    paymentCardReference: input.cardToken,
    cardTransactionAccountReference: canonicalAccountRef,
    // QE:none fields - encrypted by L2 QE client on write
    rawGatewayPayload: input.gatewayPayload,
    processorTransactionMetadata: { processedAt: now.toISOString() },
    cardTransactionAmount: { amount: input.amount, currency: input.currency },
    cardTransactionDateTime: now,
    cardTransactionStatus: 'authorized',
    cardTransactionType: input.cardTransactionType as CardTransactionLogControlRecord['cardTransactionType'],
    cardTransactionChannel: input.cardTransactionChannel as CardTransactionLogControlRecord['cardTransactionChannel'],
    cardTransactionInitiationType: 'customerInitiated',
    cardTransactionMerchantCategoryCode: input.cardTransactionMerchantCategoryCode,
    cardTransactionMerchantName: input.cardTransactionMerchantName,
    cardTransactionMaskedPanDisplay: input.cardTransactionMaskedPanDisplay,
    ...(input.merchantAgreementInstanceReference && { merchantAgreementInstanceReference: input.merchantAgreementInstanceReference }),
    cardTransactionDescription: input.cardTransactionDescription,
    ...(input.cardTransactionNarrative && { cardTransactionNarrative: input.cardTransactionNarrative }),
    bianServiceDomain: 'Card Transaction',
    bianControlRecordType: 'CardTransactionLog',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 3,
  };

  await txWriteDb.collection(CARD_TRANSACTION_COLLECTION).insertOne(txn as object);

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

    // Reuse the agreement resolved above for the fraud-case customer linkage.
    const customerAgreementUuid = resolved.uuid ?? input.accountReference;

    const fraudCase = await createFraudCase(db, txnId, customerAgreementUuid, reasons, severity, snapshot);
    fraudCaseRef = fraudCase.fraudDiagnosisInstanceReference;
  }

  emitProcessEvent(db, {
    entityType: 'transaction',
    entityId: txnId,
    processType: 'payment_processing',
    processAction: 'transaction.authorized',
    processOutcome: 'approved',
    performedByPartyReference: null,
    performedByRole: null,
    eventSummary: {
      amount: input.amount,
      currency: input.currency,
      channel: input.cardTransactionChannel,
      merchantName: input.cardTransactionMerchantName,
      fraudCaseCreated: create,
    },
    bianServiceDomain: 'Card Transaction',
    bianControlRecordType: 'CardTransactionRecord',
    processMeta: { ruleIds: reasons },
  });

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
  role: 'level1_analyst' | 'level2_investigator' | 'security_auditor' | 'customer' | 'merchant_officer' = 'level1_analyst',
  escalationToken?: string
) {
  // v2: use role-aware QE client. L2 auto-decrypts sensitive fields; L1 returns Binary.
  const { validateToken } = await import('../../../vendors/security/escalationTokens');
  const hasValidToken = validateToken(escalationToken).valid;
  const roleDb = await getDbForRole(role, hasValidToken);

  const txn = await roleDb.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
    .findOne({ cardTransactionInstanceReference: id } as Partial<CardTransactionLogControlRecord>);
  if (!txn) return null;

  // Detect whether rawGatewayPayload was decrypted (plain object) or still Binary
  const raw = txn.rawGatewayPayload as unknown;
  const gatewayDecrypted =
    raw !== undefined && raw !== null &&
    typeof raw === 'object' &&
    !('sub_type' in (raw as object) && 'buffer' in (raw as object));

  return {
    cardTransactionInstanceReference:    txn.cardTransactionInstanceReference,
    cardTransactionAmount:               txn.cardTransactionAmount,
    cardTransactionDateTime:             txn.cardTransactionDateTime,
    cardTransactionStatus:               txn.cardTransactionStatus,
    cardTransactionType:                 txn.cardTransactionType,
    cardTransactionMerchantName:         txn.cardTransactionMerchantName,
    cardTransactionMerchantCategoryCode: txn.cardTransactionMerchantCategoryCode,
    cardTransactionMaskedPanDisplay:     txn.cardTransactionMaskedPanDisplay,
    cardTransactionChannel:              txn.cardTransactionChannel,
    cardTransactionInitiationType:       txn.cardTransactionInitiationType,
    cardTransactionDescription:          txn.cardTransactionDescription,
    cardTransactionNarrative:            txn.cardTransactionNarrative,
    paymentCardReference:                txn.paymentCardReference,
    cardTransactionAccountReference:     txn.cardTransactionAccountReference,
    ...(gatewayDecrypted && {
      sensitive: {
        rawGatewayPayload:            txn.rawGatewayPayload,
        processorTransactionMetadata: txn.processorTransactionMetadata,
      },
    }),
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

export async function getTransactionsByCardToken(db: Db, value: string) {
  // Detect masked PAN (contains * or matches ****-****-****-XXXX pattern)
  // and route to the correct plaintext field.
  const isMaskedPan = value.includes('*') || /^\*{4}[-\s]?\*{4}[-\s]?\*{4}[-\s]?\d{4}$/.test(value);

  const query = isMaskedPan
    ? { cardTransactionMaskedPanDisplay: value }
    : { paymentCardReference: value };

  const results = await db.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
    .find(query as Partial<CardTransactionLogControlRecord>)
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

  // Lookup by email resolves the customer's canonical account reference, then
  // matches cardTransactionAccountReference (QE:equality) directly. This covers
  // BOTH seeded transactions (accountReference = ACC-xxx) and simulator-created
  // ones (normalized to ACC-xxx on write), regardless of saved-card linkage.
  // A QE-capable client is required for the equality token on the encrypted field.
  let readDb = db;
  if (filters.email) {
    const qeDb = await getDbForRole('level1_analyst', false);
    readDb = qeDb;

    const party = await qeDb
      .collection<PartyControlRecord>(PARTY_COLLECTION)
      .findOne({ partyEmailAddress: filters.email } as Partial<PartyControlRecord>);
    if (!party) return { results: [], total: 0, page, limit };

    const agreement = await qeDb
      .collection<{ customerAgreementReference?: string }>(CUSTOMER_AGREEMENT_COLLECTION)
      .findOne({ partyInstanceReference: party.partyInstanceReference } as Record<string, unknown>);
    const accRef = agreement?.customerAgreementReference;
    if (!accRef) return { results: [], total: 0, page, limit };

    query['cardTransactionAccountReference'] = accRef;
  }

  const skip = (page - 1) * limit;
  const [results, total] = await Promise.all([
    readDb.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
      .find(query)
      .sort({ cardTransactionDateTime: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    readDb.collection(CARD_TRANSACTION_COLLECTION).countDocuments(query),
  ]);

  return { results, total, page, limit };
}

/**
 * Acquiring-side view (BIAN SD-89 Merchant Relations): list the payments a merchant
 * RECEIVED, scoped by merchantAgreementInstanceReference (plaintext, indexed).
 *
 * PCI DSS data minimization (Req 3 / Req 7): the projection deliberately EXCLUDES
 * the payer's PII — no account reference / email, no rawGatewayPayload. The merchant
 * sees only the acquiring essentials: masked PAN, amount, status, type, channel,
 * descriptor and timestamp. No QE client needed (no encrypted field is queried).
 */
export async function getMerchantTransactions(
  db: Db,
  merchantId: string,
  page: number,
  limit: number,
  filters?: { status?: string; search?: string },
) {
  const query: Record<string, unknown> = { merchantAgreementInstanceReference: merchantId };
  if (filters?.status) query['cardTransactionStatus'] = filters.status;
  if (filters?.search) {
    // Plaintext fields only (no PII): masked PAN suffix or descriptor. Case-insensitive.
    const rx = { $regex: filters.search, $options: 'i' };
    query['$or'] = [
      { cardTransactionMaskedPanDisplay: rx },
      { cardTransactionDescription: rx },
      { cardTransactionMerchantName: rx },
    ];
  }
  const projection = {
    _id: 0,
    cardTransactionInstanceReference: 1,
    cardTransactionAmount: 1,
    cardTransactionDateTime: 1,
    cardTransactionStatus: 1,
    cardTransactionType: 1,
    cardTransactionChannel: 1,
    cardTransactionMerchantName: 1,
    cardTransactionMaskedPanDisplay: 1,
    cardTransactionDescription: 1,
  };
  const skip = (page - 1) * limit;
  const [results, total] = await Promise.all([
    db.collection<CardTransactionLogControlRecord>(CARD_TRANSACTION_COLLECTION)
      .find(query)
      .project(projection)
      .sort({ cardTransactionDateTime: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection(CARD_TRANSACTION_COLLECTION).countDocuments(query),
  ]);
  return { results, total, page, limit };
}

/**
 * Acquiring-side analytics (BIAN Merchant Activity Analysis flavor) for a merchant's
 * received payments. Pure aggregation over plaintext fields — no PII, no decryption.
 * `$toDate` tolerates both Date and ISO-string `cardTransactionDateTime` values.
 */
export async function getMerchantStats(db: Db, merchantId: string) {
  const coll = db.collection(CARD_TRANSACTION_COLLECTION);
  const match = { merchantAgreementInstanceReference: merchantId };

  const [totalsAgg, byStatus, byMonth, byCurrency] = await Promise.all([
    coll.aggregate([
      { $match: match },
      { $group: { _id: null, count: { $sum: 1 }, totalAmount: { $sum: '$cardTransactionAmount.amount' }, avgAmount: { $avg: '$cardTransactionAmount.amount' } } },
    ]).toArray(),
    coll.aggregate([
      { $match: match },
      { $group: { _id: '$cardTransactionStatus', count: { $sum: 1 }, amount: { $sum: '$cardTransactionAmount.amount' } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    coll.aggregate([
      { $match: match },
      { $group: { _id: { y: { $year: { $toDate: '$cardTransactionDateTime' } }, m: { $month: { $toDate: '$cardTransactionDateTime' } } }, count: { $sum: 1 }, amount: { $sum: '$cardTransactionAmount.amount' } } },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]).toArray(),
    coll.aggregate([
      { $match: match },
      { $group: { _id: '$cardTransactionAmount.currency', count: { $sum: 1 }, amount: { $sum: '$cardTransactionAmount.amount' } } },
      { $sort: { amount: -1 } },
    ]).toArray(),
  ]);

  const totals = totalsAgg[0] ?? { count: 0, totalAmount: 0, avgAmount: 0 };
  return {
    count: totals.count ?? 0,
    totalAmount: totals.totalAmount ?? 0,
    avgAmount: totals.avgAmount ?? 0,
    byStatus:   byStatus.map((s) => ({ status: s._id as string, count: s.count as number, amount: s.amount as number })),
    byMonth:    byMonth.map((s) => ({ year: (s._id as { y: number }).y, month: (s._id as { m: number }).m, count: s.count as number, amount: s.amount as number })),
    byCurrency: byCurrency.map((s) => ({ currency: s._id as string, count: s.count as number, amount: s.amount as number })),
  };
}

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
import { PAYMENT_CARD_COLLECTION } from '../../customer/models/paymentCard.model';

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

  // v2: sensitive gateway fields (QE:none, DEK-sensitive tier) are written inline.
  // Use the Level 2 QE client so the driver encrypts them with the correct DEKs.
  const txWriteDb = await getDbForRole('security_auditor', false);

  const txn: CardTransactionLogControlRecord = {
    cardTransactionInstanceReference: txnId,
    paymentCardReference: input.cardToken,
    cardTransactionAccountReference: input.accountReference,
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

    // Resolve the customerAgreementInstanceReference UUID from the account reference.
    // Two paths:
    //   Email path:     accountReference is an email → resolve party by email → find agreement by partyInstanceReference
    //   Reference path: accountReference is a business key → find agreement by customerAgreementReference
    let customerAgreementUuid = input.accountReference;
    try {
      const l1Db = await getDbForRole('level1_analyst', false);
      if (input.accountReference.includes('@')) {
        const partyDoc = await db
          .collection<PartyControlRecord>(PARTY_COLLECTION)
          .findOne({ partyEmailAddress: input.accountReference } as Partial<PartyControlRecord>);
        if (partyDoc?.partyInstanceReference) {
          const agreementDoc = await l1Db
            .collection<{ customerAgreementInstanceReference: string }>(CUSTOMER_AGREEMENT_COLLECTION)
            .findOne({ partyInstanceReference: partyDoc.partyInstanceReference } as Record<string, unknown>);
          if (agreementDoc?.customerAgreementInstanceReference) {
            customerAgreementUuid = agreementDoc.customerAgreementInstanceReference;
          }
        }
      } else {
        const agreementDoc = await l1Db
          .collection<{ customerAgreementInstanceReference: string }>(CUSTOMER_AGREEMENT_COLLECTION)
          .findOne({ customerAgreementReference: input.accountReference } as Record<string, unknown>);
        if (agreementDoc?.customerAgreementInstanceReference) {
          customerAgreementUuid = agreementDoc.customerAgreementInstanceReference;
        }
      }
    } catch {
      // Keep account reference as fallback - raw document lookup will fail but fraud case still created
    }

    const fraudCase = await createFraudCase(db, txnId, customerAgreementUuid, reasons, severity, snapshot);
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

  // Four-step lookup by email using only plaintext fields after the initial QE search.
  // Step 1: QE:equality search on party.partyEmailAddress (SD-13)
  // Step 2: plaintext FK lookup on customerAgreementProcedure.partyInstanceReference
  // Step 3: plaintext FK lookup on paymentCardManagement.customerAgreementInstanceReference
  // Step 4: plaintext $in filter on cardTransactionLog.paymentCardReference
  if (filters.email) {
    const party = await db
      .collection<PartyControlRecord>(PARTY_COLLECTION)
      .findOne({ partyEmailAddress: filters.email } as Partial<PartyControlRecord>);

    if (!party) {
      return { results: [], total: 0, page, limit };
    }

    const agreement = await db
      .collection(CUSTOMER_AGREEMENT_COLLECTION)
      .findOne({ partyInstanceReference: party.partyInstanceReference } as Record<string, unknown>);

    if (!agreement) {
      return { results: [], total: 0, page, limit };
    }

    const customerUuid = (agreement as Record<string, unknown>).customerAgreementInstanceReference as string;
    if (!customerUuid) {
      return { results: [], total: 0, page, limit };
    }

    // Get all card tokens for this customer via the plaintext paymentCardManagement FK
    const cards = await db
      .collection(PAYMENT_CARD_COLLECTION)
      .find({ customerAgreementInstanceReference: customerUuid })
      .project({ paymentCardReference: 1 })
      .toArray();

    const cardTokens = cards
      .map(c => (c as Record<string, unknown>)['paymentCardReference'] as string)
      .filter(Boolean);

    if (cardTokens.length === 0) {
      return { results: [], total: 0, page, limit };
    }

    // Filter transactions by the collected card tokens (paymentCardReference is plaintext)
    query['paymentCardReference'] = { $in: cardTokens };
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

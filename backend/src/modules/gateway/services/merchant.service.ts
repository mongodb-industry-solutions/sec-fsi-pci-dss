// BIAN SD-89: Merchant Relations service
// Full MongoDB-backed implementation (replaces in-memory stub from v4 prototype).

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { hash as bcryptHash, compare as bcryptCompare } from 'bcryptjs';
import {
  MERCHANT_AGREEMENT_COLLECTION,
  MerchantAgreementControlRecord,
  MerchantAgreementStatus,
  MerchantApiKeyRecord,
} from '../models/merchantAgreement.model';

const BCRYPT_ROUNDS = 10;
const API_KEY_PREFIX = 'lbpk_live_';
const API_KEY_RANDOM_BYTES = 16; // 32 hex chars

function generatePlaintextApiKey(): string {
  return API_KEY_PREFIX + randomBytes(API_KEY_RANDOM_BYTES).toString('hex');
}

export interface CreateMerchantInput {
  merchantName: string;
  merchantLegalEntityReference: string;
  merchantCategoryCode: string;
  merchantCountryCode: string;
  merchantTier?: 'standard' | 'enterprise';
  merchantAllowedCurrencies?: string[];
  merchantTransactionLimitAmount?: number;
  merchantWebhookEndpoint?: string;
  merchantSettlementSchedule?: 'T+1' | 'T+2' | 'T+3';
}

export async function getMerchants(
  db: Db,
  filters: { status?: MerchantAgreementStatus; mcc?: string }
) {
  const query: Record<string, unknown> = {};
  if (filters.status) query.merchantAgreementStatus = filters.status;
  if (filters.mcc) query.merchantCategoryCode = filters.mcc;

  const results = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .find(query)
    .project({ merchantApiKeys: 0 }) // Never expose key hashes
    .toArray();

  return { results, total: results.length };
}

export async function getMerchantById(db: Db, id: string) {
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne(
      { merchantAgreementInstanceReference: id } as Partial<MerchantAgreementControlRecord>,
      { projection: { merchantApiKeys: 0, merchantWebhookSecret: 0 } }
    );
  return merchant ?? null;
}

export async function createMerchant(db: Db, input: CreateMerchantInput) {
  const id = uuidv4();
  const now = new Date();

  // Generate initial API key
  const plaintext = generatePlaintextApiKey();
  const keyHashBcrypt = await bcryptHash(plaintext, BCRYPT_ROUNDS);
  const initialKey: MerchantApiKeyRecord = {
    keyId: uuidv4(),
    keyPrefix: plaintext.slice(0, 12),
    keyHashBcrypt,
    keyStatus: 'active',
    keyCreatedDateTime: now,
  };

  const riskMcc = ['5812', '6011', '7995'];
  const merchantRiskCategory =
    riskMcc.includes(input.merchantCategoryCode) ? 'high' : 'low';

  const merchant: MerchantAgreementControlRecord = {
    merchantAgreementInstanceReference: id,
    merchantName: input.merchantName,
    merchantLegalEntityReference: input.merchantLegalEntityReference,
    merchantCategoryCode: input.merchantCategoryCode,
    merchantCountryCode: input.merchantCountryCode,
    merchantAgreementStatus: 'active',
    merchantTier: input.merchantTier ?? 'standard',
    merchantAllowedCurrencies: input.merchantAllowedCurrencies ?? ['USD'],
    merchantTransactionLimitAmount: input.merchantTransactionLimitAmount ?? 10000,
    merchantWebhookEndpoint: input.merchantWebhookEndpoint,
    merchantWebhookSecret: randomBytes(20).toString('hex'),
    merchantSettlementSchedule: input.merchantSettlementSchedule ?? 'T+2',
    merchantAverageTransactionAmount: 0,
    merchantTransactionCount30d: 0,
    merchantRiskCategory,
    merchantApiKeys: [initialKey],
    bianServiceDomain: 'Merchant Relations',
    bianControlRecordType: 'MerchantAgreementProcedure',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };

  await db.collection(MERCHANT_AGREEMENT_COLLECTION).insertOne(merchant as object);

  return {
    merchantAgreementInstanceReference: id,
    merchantName: input.merchantName,
    merchantAgreementStatus: 'active' as MerchantAgreementStatus,
    merchantRiskCategory,
    // Plaintext key returned ONCE - never retrievable again
    merchantApiKey: plaintext,
  };
}

export async function updateMerchant(
  db: Db,
  id: string,
  patch: Partial<Pick<
    MerchantAgreementControlRecord,
    | 'merchantTransactionLimitAmount'
    | 'merchantWebhookEndpoint'
    | 'merchantSettlementSchedule'
    | 'merchantAgreementStatus'
    | 'merchantAllowedCurrencies'
  >>
) {
  const result = await db.collection(MERCHANT_AGREEMENT_COLLECTION).findOneAndUpdate(
    { merchantAgreementInstanceReference: id },
    { $set: { ...patch, recordUpdatedDateTime: new Date() } },
    { returnDocument: 'after', projection: { merchantApiKeys: 0, merchantWebhookSecret: 0 } }
  );
  return result ?? null;
}

export async function registerWebhook(db: Db, merchantId: string, url: string) {
  const result = await db.collection(MERCHANT_AGREEMENT_COLLECTION).findOneAndUpdate(
    { merchantAgreementInstanceReference: merchantId },
    { $set: { merchantWebhookEndpoint: url, recordUpdatedDateTime: new Date() } },
    { returnDocument: 'after', projection: { merchantWebhookEndpoint: 1, merchantAgreementInstanceReference: 1 } }
  );
  if (!result) return null;
  return {
    merchantAgreementInstanceReference: merchantId,
    merchantWebhookEndpoint: url,
  };
}

export async function generateApiKey(
  db: Db,
  merchantId: string
): Promise<{ keyId: string; keyPrefix: string; merchantApiKey: string } | null> {
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ merchantAgreementInstanceReference: merchantId } as Partial<MerchantAgreementControlRecord>);

  if (!merchant) return null;

  const plaintext = generatePlaintextApiKey();
  const keyHashBcrypt = await bcryptHash(plaintext, BCRYPT_ROUNDS);
  const now = new Date();

  const newKey: MerchantApiKeyRecord = {
    keyId: uuidv4(),
    keyPrefix: plaintext.slice(0, 12),
    keyHashBcrypt,
    keyStatus: 'active',
    keyCreatedDateTime: now,
  };

  await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
    { merchantAgreementInstanceReference: merchantId },
    { $push: { merchantApiKeys: newKey }, $set: { recordUpdatedDateTime: now } } as object
  );

  return {
    keyId: newKey.keyId,
    keyPrefix: newKey.keyPrefix,
    merchantApiKey: plaintext, // Returned ONCE - never stored in plaintext
  };
}

export async function revokeApiKey(
  db: Db,
  merchantId: string,
  keyId: string
): Promise<'ok' | 'not_found'> {
  const result = await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
    {
      merchantAgreementInstanceReference: merchantId,
      'merchantApiKeys.keyId': keyId,
    },
    { $set: { 'merchantApiKeys.$.keyStatus': 'revoked', recordUpdatedDateTime: new Date() } }
  );

  return result.matchedCount > 0 ? 'ok' : 'not_found';
}

export async function verifyApiKey(
  db: Db,
  merchantId: string,
  plaintext: string
): Promise<boolean> {
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ merchantAgreementInstanceReference: merchantId } as Partial<MerchantAgreementControlRecord>);

  if (!merchant) return false;

  const activeKeys = merchant.merchantApiKeys?.filter((k) => k.keyStatus === 'active') ?? [];

  for (const key of activeKeys) {
    const match = await bcryptCompare(plaintext, key.keyHashBcrypt);
    if (match) {
      // Update last used timestamp (fire-and-forget)
      db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
        { merchantAgreementInstanceReference: merchantId, 'merchantApiKeys.keyId': key.keyId },
        { $set: { 'merchantApiKeys.$.keyLastUsedDateTime': new Date() } }
      ).catch(() => {});
      return true;
    }
  }

  return false;
}

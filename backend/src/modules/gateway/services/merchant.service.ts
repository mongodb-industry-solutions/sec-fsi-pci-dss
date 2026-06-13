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
  MerchantAgreementKybCheck,
  KybCheckStatus,
  MerchantApiKeyRecord,
} from '../models/merchantAgreement.model';
import { emitComplianceEvent } from '../../integrations/services/businessProcessEvent.service';

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
  merchantOwnerPartyReference?: string;  // Ch-05: FK → party.partyInstanceReference (SD-13)
  merchantTier?: 'standard' | 'enterprise';
  merchantAllowedCurrencies?: string[];
  merchantTransactionLimitAmount?: number;
  merchantWebhookEndpoint?: string;
  merchantSettlementSchedule?: 'T+1' | 'T+2' | 'T+3';
}

export async function getMerchants(
  db: Db,
  filters: { status?: MerchantAgreementStatus; mcc?: string; name?: string; risk?: string; page?: number; limit?: number }
) {
  const query: Record<string, unknown> = {};
  if (filters.status) query.merchantAgreementStatus = filters.status;
  if (filters.mcc) query.merchantCategoryCode = filters.mcc;
  if (filters.name) query.merchantName = { $regex: filters.name, $options: 'i' };
  if (filters.risk) query.merchantRiskCategory = filters.risk;

  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const skip = (page - 1) * limit;

  const col = db.collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION);
  const [results, total] = await Promise.all([
    col.find(query).project({ merchantApiKeys: 0 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(query),
  ]);

  return { results, total };
}

// Ch-05: dual-role lookup — customer finds their own merchant by partyRef (SD-13 FK)
export async function getMerchantPicker(
  db: Db,
  filters: { q?: string; limit?: number }
) {
  const query: Record<string, unknown> = { merchantAgreementStatus: 'active' };
  if (filters.q) query.merchantName = { $regex: filters.q, $options: 'i' };

  const limit = Math.min(50, Math.max(1, filters.limit ?? 4));
  const col = db.collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION);

  const [results, total] = await Promise.all([
    col
      .find(query)
      .project({
        _id: 0,
        merchantAgreementInstanceReference: 1,
        merchantName: 1,
        merchantCategoryCode: 1,
        merchantRiskCategory: 1,
      })
      .sort({ merchantName: 1 })
      .limit(limit)
      .toArray(),
    col.countDocuments(query),
  ]);

  return { results, total };
}

export async function getMerchantByOwnerPartyRef(db: Db, partyRef: string) {
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne(
      { merchantOwnerPartyReference: partyRef } as Partial<MerchantAgreementControlRecord>,
      { projection: { merchantApiKeys: 0, merchantWebhookSecret: 0 } }
    );
  return merchant ?? null;
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

// ── Merchant lifecycle audit trail (BIAN SD-89, PCI DSS Req 10) ─────────────────
// Append-only event log of merchant relationship actions (submitted, approved,
// rejected, KYB, config updates). No cardholder data — operational metadata only.
export const MERCHANT_EVENTS_COLLECTION = 'merchantAgreementEvents';

export interface MerchantAgreementEvent {
  merchantAgreementEventInstanceReference: string;
  merchantAgreementInstanceReference: string;
  eventType: string;
  eventDateTime: Date;
  performedByPartyReference?: string;
  performedByRole?: string;
  details?: Record<string, unknown>;
  bianServiceDomain: 'Merchant Relations';
  bianControlRecordType: 'MerchantAgreementProcedure';
}

export async function appendMerchantEvent(
  db: Db,
  merchantId: string,
  eventType: string,
  opts?: { performedByPartyReference?: string; performedByRole?: string; details?: Record<string, unknown> },
): Promise<void> {
  const event: MerchantAgreementEvent = {
    merchantAgreementEventInstanceReference: uuidv4(),
    merchantAgreementInstanceReference: merchantId,
    eventType,
    eventDateTime: new Date(),
    ...(opts?.performedByPartyReference && { performedByPartyReference: opts.performedByPartyReference }),
    ...(opts?.performedByRole && { performedByRole: opts.performedByRole }),
    ...(opts?.details && { details: opts.details }),
    bianServiceDomain: 'Merchant Relations',
    bianControlRecordType: 'MerchantAgreementProcedure',
  };
  await db.collection(MERCHANT_EVENTS_COLLECTION).insertOne(event as object);
}

export async function getMerchantEvents(db: Db, merchantId: string) {
  return db.collection<MerchantAgreementEvent>(MERCHANT_EVENTS_COLLECTION)
    .find({ merchantAgreementInstanceReference: merchantId })
    .sort({ eventDateTime: 1 })
    .limit(200)
    .toArray();
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
    merchantAgreementStatus: 'under_review',   // Ch-05: starts at under_review — officer must approve
    ...(input.merchantOwnerPartyReference && { merchantOwnerPartyReference: input.merchantOwnerPartyReference }),
    // Ch-06: BQ:Step — KYB initiated at application time (BIAN SD-89 BQ:Step)
    merchantAgreementKybCheck: {
      merchantAgreementKybCheckStatus: 'initiated' as KybCheckStatus,
    } satisfies MerchantAgreementKybCheck,
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

  await appendMerchantEvent(db, id, 'merchant.submitted', {
    performedByPartyReference: input.merchantOwnerPartyReference,
    performedByRole: 'customer',
    details: { merchantAgreementStatus: 'under_review', kyb: 'initiated' },
  });

  emitComplianceEvent(db, {
    entityType: 'merchant',
    entityId: id,
    processType: 'merchant_onboarding',
    processAction: 'merchant.submitted',
    processOutcome: 'pending',
    performedByPartyReference: input.merchantOwnerPartyReference ?? null,
    performedByRole: 'customer',
    eventSummary: { merchantName: input.merchantName, merchantCategoryCode: input.merchantCategoryCode, merchantRiskCategory },
    bianServiceDomain: 'Merchant Relations',
    bianControlRecordType: 'MerchantAgreementProcedure',
  });

  return {
    merchantAgreementInstanceReference: id,
    merchantName: input.merchantName,
    merchantAgreementStatus: 'under_review' as MerchantAgreementStatus,
    merchantRiskCategory,
    message: 'Application submitted. A Merchant Acquiring officer will review within 2 business days.',
  };
}

// Ch-05: BIAN Action Term: Control — merchant_officer approves or rejects an application
export async function reviewMerchantApplication(
  db: Db,
  merchantId: string,
  reviewerPartyRef: string,
  action: 'approve' | 'reject',
  reviewNote?: string
): Promise<'ok' | 'not_found' | 'invalid_status'> {
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ merchantAgreementInstanceReference: merchantId } as Partial<MerchantAgreementControlRecord>);

  if (!merchant) return 'not_found';
  if (merchant.merchantAgreementStatus !== 'under_review') return 'invalid_status';

  const newStatus: MerchantAgreementStatus = action === 'approve' ? 'agreed' : 'rejected';
  const now = new Date();

  const kybStatus: KybCheckStatus = action === 'approve' ? 'verified' : 'rejected';

  await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
    { merchantAgreementInstanceReference: merchantId },
    {
      $set: {
        merchantAgreementStatus: newStatus,
        // Top-level fields kept for backward compat (Ch-05)
        merchantReviewNote: reviewNote ?? '',
        merchantReviewedByPartyReference: reviewerPartyRef,
        merchantReviewedDateTime: now,
        // Ch-06: BQ:Step — formal KYB check record (BIAN SD-89 BQ:Step). PCI DSS Req 12.8.
        merchantAgreementKybCheck: {
          merchantAgreementKybCheckStatus: kybStatus,
          merchantAgreementKybCheckCompletedDate: now,
          merchantAgreementKybCheckNotes: reviewNote ?? '',
          merchantAgreementKybCheckPerformedByPartyReference: reviewerPartyRef,
        } satisfies MerchantAgreementKybCheck,
        recordUpdatedDateTime: now,
      },
    }
  );

  await appendMerchantEvent(db, merchantId, action === 'approve' ? 'merchant.approved' : 'merchant.rejected', {
    performedByPartyReference: reviewerPartyRef,
    performedByRole: 'merchant_officer',
    details: { merchantAgreementStatus: newStatus, kybStatus, reviewNote: reviewNote ?? '' },
  });

  emitComplianceEvent(db, {
    entityType: 'merchant',
    entityId: merchantId,
    processType: 'kyb_verification',
    processAction: action === 'approve' ? 'kyb.verified' : 'kyb.rejected',
    processOutcome: action === 'approve' ? 'approved' : 'rejected',
    performedByPartyReference: reviewerPartyRef,
    performedByRole: 'merchant_officer',
    eventSummary: { kybStatus, reviewNote: reviewNote ?? '', merchantAgreementStatus: newStatus },
    bianServiceDomain: 'Merchant Relations',
    bianControlRecordType: 'MerchantAgreementProcedure',
  });

  return 'ok';
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
  if (result) {
    await appendMerchantEvent(db, id, 'merchant.updated', { details: { fields: Object.keys(patch) } });
  }
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
  merchantId: string,
  label?: string,
): Promise<{ keyId: string; keyPrefix: string; keyLabel?: string; merchantApiKey: string } | null> {
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
    ...(label?.trim() && { keyLabel: label.trim() }),
  };

  await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
    { merchantAgreementInstanceReference: merchantId },
    { $push: { merchantApiKeys: newKey }, $set: { recordUpdatedDateTime: now } } as object
  );

  return {
    keyId: newKey.keyId,
    keyPrefix: newKey.keyPrefix,
    keyLabel: newKey.keyLabel,
    merchantApiKey: plaintext, // Returned ONCE - never stored in plaintext
  };
}

/**
 * Returns API key METADATA only (never the hash or plaintext): id, prefix, label,
 * status, created/last-used dates. BIAN SD-89 credential management; PCI DSS Req 3/8.
 */
export async function getMerchantApiKeys(db: Db, merchantId: string) {
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne(
      { merchantAgreementInstanceReference: merchantId } as Partial<MerchantAgreementControlRecord>,
      { projection: { merchantApiKeys: 1 } },
    );
  if (!merchant) return null;
  return (merchant.merchantApiKeys ?? []).map((k) => ({
    keyId: k.keyId,
    keyPrefix: k.keyPrefix,
    keyLabel: k.keyLabel ?? null,
    keyStatus: k.keyStatus,
    keyCreatedDateTime: k.keyCreatedDateTime,
    keyLastUsedDateTime: k.keyLastUsedDateTime ?? null,
  }));
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

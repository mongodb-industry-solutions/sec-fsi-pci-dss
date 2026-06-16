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
import { emitComplianceEvent } from '../../providers/services/businessProcessEvent.service';
import { deliverWebhook } from './webhook.service';
import { createNotification } from '../../notifications/notifications.service';

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

// Ch-05: dual-role lookup; customer finds their own merchant by partyRef (SD-13 FK)
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
// rejected, KYB, config updates). No cardholder data; operational metadata only.
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
    merchantAgreementStatus: 'under_review',   // Ch-05: starts at under_review; officer must approve
    ...(input.merchantOwnerPartyReference && { merchantOwnerPartyReference: input.merchantOwnerPartyReference }),
    // Ch-06: BQ:Step; KYB initiated at application time (BIAN SD-89 BQ:Step)
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

// Ch-05: BIAN Action Term: Control; merchant_officer approves or rejects an application
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
        // Ch-06: BQ:Step; formal KYB check record (BIAN SD-89 BQ:Step). PCI DSS Req 12.8.
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

  // Notify the merchant owner when KYB is approved (ADR-031 account-status notification).
  if (action === 'approve' && merchant.merchantOwnerPartyReference) {
    await createNotification(db, {
      recipientPartyReference: merchant.merchantOwnerPartyReference,
      notificationType: 'kyb_status',
      title: 'Your business verification (KYB) was approved',
      detail: `Your merchant${merchant.merchantName ? ` "${merchant.merchantName}"` : ''} passed KYB verification and can now accept payments.`,
      href: `/system/merchant/${merchantId}`,
      relatedReference: `kyb-${merchantId}`,
      actionable: false,
    }).catch(() => { /* non-blocking */ });
  }

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
  const existing = await db.collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION).findOne(
    { merchantAgreementInstanceReference: merchantId } as Partial<MerchantAgreementControlRecord>,
    { projection: { merchantWebhookSecret: 1 } },
  );
  if (!existing) return null;

  // A webhook needs a signing secret to be USABLE; without it the PSP cannot HMAC-sign the callback
  // and treats the endpoint as not configured. Saving the URL therefore guarantees a secret exists
  // (generated once, kept thereafter). The secret is the webhook's authentication (X-Webhook-Signature).
  const secret = (existing as { merchantWebhookSecret?: string }).merchantWebhookSecret || `whsec_${randomBytes(24).toString('hex')}`;
  await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
    { merchantAgreementInstanceReference: merchantId },
    { $set: { merchantWebhookEndpoint: url, merchantWebhookSecret: secret, recordUpdatedDateTime: new Date() } },
  );
  return {
    merchantAgreementInstanceReference: merchantId,
    merchantWebhookEndpoint: url,
    merchantWebhookSecret: secret, // returned so the merchant can verify signatures
  };
}

/**
 * Send a SIMULATED `payment.completed` webhook to the merchant's configured endpoint so they can
 * verify their integration WITHOUT running a full payment. Returns the exact payload sent plus the
 * delivery outcome (status, attempts, the merchant's response, or an error). HMAC-signed like a real
 * event; sample (clearly `test: true`) data only; no real CHD.
 */
// The default representative payload (same SHAPE as a real `payment.completed` callback). Exposed so
// the UI can show/pre-fill it for editing before sending the test.
export function buildSampleWebhookPayload(merchantId: string): Record<string, unknown> {
  return {
    event: 'payment.completed',
    result: 'approved',
    test: true,
    cardToken: 'tok_test000000000000',
    maskedPan: '****-****-****-4242',
    responseCode: '0000',
    authorizationCode: 'TEST01',
    amount: 49.99,
    currency: 'USD',
    merchantReference: 'TEST-ORDER-0001',
    merchantAgreementInstanceReference: merchantId,
    transactionId: '00000000-0000-4000-8000-000000000000',
    cardTransactionInstanceReference: '00000000-0000-4000-8000-000000000000',
  };
}

export async function sendTestWebhook(
  db: Db,
  merchantId: string,
  opts?: { payload?: Record<string, unknown>; extraHeaders?: Record<string, string> },
): Promise<
  | { configured: false }
  | { configured: true; endpoint: string; payload: Record<string, unknown>; requestHeaders: Record<string, string>; signature: string; delivered: boolean; statusCode?: number; attempts: number; response?: unknown; error?: string }
  | null
> {
  const m = await db.collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION).findOne(
    { merchantAgreementInstanceReference: merchantId } as Partial<MerchantAgreementControlRecord>,
    { projection: { merchantWebhookEndpoint: 1, merchantWebhookSecret: 1, merchantName: 1 } },
  );
  if (!m) return null;
  const endpoint = (m as { merchantWebhookEndpoint?: string }).merchantWebhookEndpoint;
  const secret = (m as { merchantWebhookSecret?: string }).merchantWebhookSecret;
  if (!endpoint || !secret) return { configured: false };

  // Use the (optionally edited) payload from the caller, else the default sample.
  const payload = opts?.payload ?? buildSampleWebhookPayload(merchantId);

  const r = await deliverWebhook(
    endpoint,
    { event: String(payload.event ?? 'payment.completed'), timestamp: new Date().toISOString(), data: payload },
    secret,
    { extraHeaders: opts?.extraHeaders },
  );
  return {
    configured: true,
    endpoint,
    payload,
    requestHeaders: r.request.headers,
    signature: r.request.headers['X-Webhook-Signature'] ?? '',
    delivered: r.delivered,
    statusCode: r.statusCode,
    attempts: r.attempts,
    response: r.response,
    error: r.error,
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
    keyOrigin: 'generated',
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
 * Import an EXISTING API key supplied by the merchant's own system. PCI DSS Req 3: only the bcrypt
 * hash + a display prefix are stored; the plaintext is hashed and discarded, never persisted and
 * never returned (the merchant already holds it). Returns metadata, or 'invalid' if too short, or
 * 'duplicate' if that exact key is already registered (active) for the merchant.
 */
export async function importApiKey(
  db: Db,
  merchantId: string,
  plaintext: string,
  label?: string,
): Promise<{ keyId: string; keyPrefix: string; keyLabel?: string; keyStatus: 'active'; keyOrigin: 'imported' } | null | 'invalid' | 'duplicate'> {
  const merchant = await db
    .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
    .findOne({ merchantAgreementInstanceReference: merchantId } as Partial<MerchantAgreementControlRecord>);
  if (!merchant) return null;

  const trimmed = plaintext.trim();
  if (trimmed.length < 12) return 'invalid';

  // Reject re-importing a key already on file (compare against active keys' hashes).
  const active = (merchant.merchantApiKeys ?? []).filter((k) => k.keyStatus === 'active');
  for (const k of active) {
    if (await bcryptCompare(trimmed, k.keyHashBcrypt)) return 'duplicate';
  }

  const now = new Date();
  const newKey: MerchantApiKeyRecord = {
    keyId: uuidv4(),
    keyPrefix: trimmed.slice(0, 12),
    keyHashBcrypt: await bcryptHash(trimmed, BCRYPT_ROUNDS),
    keyStatus: 'active',
    keyCreatedDateTime: now,
    keyOrigin: 'imported',
    ...(label?.trim() && { keyLabel: label.trim() }),
  };

  await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
    { merchantAgreementInstanceReference: merchantId },
    { $push: { merchantApiKeys: newKey }, $set: { recordUpdatedDateTime: now } } as object
  );

  return { keyId: newKey.keyId, keyPrefix: newKey.keyPrefix, keyLabel: newKey.keyLabel, keyStatus: 'active', keyOrigin: 'imported' };
}

/** Update (or clear) the human label of an API key. Label is never a secret. */
export async function updateApiKeyLabel(
  db: Db,
  merchantId: string,
  keyId: string,
  label: string,
): Promise<'ok' | 'not_found'> {
  const trimmed = label.trim();
  const update = trimmed
    ? { $set: { 'merchantApiKeys.$.keyLabel': trimmed, recordUpdatedDateTime: new Date() } }
    : { $unset: { 'merchantApiKeys.$.keyLabel': '' }, $set: { recordUpdatedDateTime: new Date() } };
  const result = await db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
    { merchantAgreementInstanceReference: merchantId, 'merchantApiKeys.keyId': keyId } as object,
    update as object,
  );
  return result.matchedCount > 0 ? 'ok' : 'not_found';
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
    keyOrigin: k.keyOrigin ?? 'generated',
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

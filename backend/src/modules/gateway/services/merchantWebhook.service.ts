/**
 * WebhookService — SD-89 BQ:Notification, ADR-038
 * OOP class encapsulating the typed webhook registry: registration, delivery,
 * ISO 20022-aligned test payloads, HMAC-SHA256 signing, body mapping, and
 * persistent delivery log.
 */
import { Db } from 'mongodb';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  MERCHANT_AGREEMENT_COLLECTION,
  MerchantAgreementControlRecord,
  MerchantApiKeyRecord,
  MerchantWebhookConfig,
  WebhookEventType,
} from '../models/merchantAgreement.model';
import { MERCHANT_WEBHOOK_LOG_COLLECTION, MerchantWebhookDeliveryLog } from '../models/merchantWebhookLog.model';
import { deliverWebhook, signWebhookPayload } from './webhook.service';
import { emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';

// ── Payload type definitions (ISO 20022 pacs.002 + OIDC/RFC 7519) ────────────

export interface PaymentWebhookPayload {
  messageId: string;
  eventType: 'payment.completed' | 'payment.failed';
  timestamp: string;
  specVersion: '1.0';
  data: {
    transactionReference: string;
    merchantReference: string;
    amount: { value: number; currency: string };
    status: string;
    statusCode: string;
    authorizationCode?: string;
    maskedPan: string;
    cardToken: string;
    cardScheme?: string;
    declineReason?: string;
  };
}

export interface OAuthAuthorizationWebhookPayload {
  messageId: string;
  eventType: 'oauth.authorization_granted' | 'oauth.authorization_revoked';
  timestamp: string;
  specVersion: '1.0';
  data: {
    consentId: string;
    clientId: string;
    subject: string;
    scopes: string[];
    grantedAt?: string;
    expiresAt?: string;
    revokedAt?: string;
    revokedBy?: 'user' | 'merchant' | 'psp';
  };
}

export interface UserNotificationWebhookPayload {
  messageId: string;
  eventType: 'user.notification';
  timestamp: string;
  specVersion: '1.0';
  data: {
    notificationId: string;
    subject: string;
    notificationType: 'info' | 'warning' | 'action_required';
    title: string;
    body: string;
    actionUrl?: string;
    correlationId?: string;
  };
}

export type WebhookPayload =
  | PaymentWebhookPayload
  | OAuthAuthorizationWebhookPayload
  | UserNotificationWebhookPayload
  | { messageId: string; eventType: WebhookEventType; timestamp: string; specVersion: '1.0'; data: Record<string, unknown> };

export interface WebhookTestResult {
  delivered: boolean;
  statusCode?: number;
  attempts: number;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  response?: unknown;
  error?: string;
  signature: string;
}

// ── WebhookService class ──────────────────────────────────────────────────────

export class WebhookService {
  constructor(private readonly db: Db) {}

  // ── Static: canonical test payloads per event type ─────────────────────────

  static buildTestPayload(eventType: WebhookEventType, merchantId: string): WebhookPayload {
    const ts = new Date().toISOString();
    const messageId = uuidv4();

    switch (eventType) {
      case 'payment.completed':
        return {
          messageId, eventType, timestamp: ts, specVersion: '1.0',
          data: {
            transactionReference: '00000000-0000-4000-8000-000000000001',
            merchantReference: 'TEST-ORDER-0001',
            amount: { value: 49.99, currency: 'USD' },
            status: 'ACSC', statusCode: '0000', authorizationCode: 'TEST01',
            maskedPan: '****1234', cardToken: 'pm_test000000000000', cardScheme: 'VISA',
          },
        };
      case 'payment.failed':
        return {
          messageId, eventType, timestamp: ts, specVersion: '1.0',
          data: {
            transactionReference: '00000000-0000-4000-8000-000000000002',
            merchantReference: 'TEST-ORDER-0002',
            amount: { value: 75.00, currency: 'USD' },
            status: 'RJCT', statusCode: '0190',
            maskedPan: '****5678', cardToken: 'pm_test000000000001', cardScheme: 'MASTERCARD',
            declineReason: 'Authorization declined by the issuer',
          },
        };
      case 'oauth.authorization_granted':
        return {
          messageId, eventType, timestamp: ts, specVersion: '1.0',
          data: {
            consentId: '00000000-0000-4000-8000-000000000003',
            clientId: 'test-client-id', subject: 'usr_test00000',
            scopes: ['openid', 'profile', 'email'],
            grantedAt: ts, expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          },
        };
      case 'oauth.authorization_revoked':
        return {
          messageId, eventType, timestamp: ts, specVersion: '1.0',
          data: {
            consentId: '00000000-0000-4000-8000-000000000003',
            clientId: 'test-client-id', subject: 'usr_test00000',
            scopes: ['openid', 'profile', 'email'],
            revokedAt: ts, revokedBy: 'user',
          },
        };
      case 'user.notification':
        return {
          messageId, eventType, timestamp: ts, specVersion: '1.0',
          data: {
            notificationId: '00000000-0000-4000-8000-000000000004',
            subject: 'usr_test00000', notificationType: 'info',
            title: 'Payment processed',
            body: 'Your payment of $49.99 has been processed successfully.',
            actionUrl: 'https://merchant.example.com/orders/TEST-ORDER-0001',
            correlationId: '00000000-0000-4000-8000-000000000001',
          },
        };
      case 'dispute.opened':
        return {
          messageId, eventType, timestamp: ts, specVersion: '1.0',
          data: {
            disputeId: '00000000-0000-4000-8000-000000000005',
            transactionReference: '00000000-0000-4000-8000-000000000001',
            merchantReference: 'TEST-ORDER-0001',
            amount: { value: 49.99, currency: 'USD' },
            reasonCode: 'FRAD',
            responseDeadline: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          },
        };
      case 'kyb.status_changed':
        return {
          messageId, eventType, timestamp: ts, specVersion: '1.0',
          data: {
            merchantAgreementInstanceReference: merchantId,
            previousStatus: 'initiated', newStatus: 'verified',
            changedAt: ts, reference: 'KYB-REF-001',
          },
        };
    }
  }

  // ── Static: body field remapping ────────────────────────────────────────────

  static applyBodyMapping(
    payload: Record<string, unknown>,
    mapping?: Record<string, string>,
  ): Record<string, unknown> {
    if (!mapping || Object.keys(mapping).length === 0) return payload;
    const result = { ...payload };
    if (result.data && typeof result.data === 'object') {
      const data = { ...(result.data as Record<string, unknown>) };
      for (const [pspField, merchantField] of Object.entries(mapping)) {
        if (pspField in data) {
          data[merchantField] = data[pspField];
          if (merchantField !== pspField) delete data[pspField];
        }
      }
      result.data = data;
    }
    return result;
  }

  // ── Static: mask signing secret for GET responses ───────────────────────────

  static maskSecret(cfg: MerchantWebhookConfig): MerchantWebhookConfig {
    return { ...cfg, webhookSecret: cfg.webhookSecret.slice(0, 6) + '●'.repeat(10) };
  }

  // Resolves the configured API key auth into extra headers or body fields for delivery.
  // Uses keyPrefix (first 8 chars) — plaintext is never stored. For demo purposes only;
  // production systems should use a dedicated outbound credential stored in a secrets manager.
  static resolveApiKeyAuth(
    cfg: MerchantWebhookConfig,
    apiKeys: MerchantApiKeyRecord[],
  ): { extraHeaders?: Record<string, string>; bodyFields?: Record<string, string> } {
    if (!cfg.webhookApiKeyId || !cfg.webhookApiKeyTransport || !cfg.webhookApiKeyFieldName) return {};
    const key = apiKeys.find((k) => k.keyId === cfg.webhookApiKeyId && k.keyStatus === 'active');
    if (!key) return {};
    const value = key.keyPrefix;
    if (cfg.webhookApiKeyTransport === 'header') return { extraHeaders: { [cfg.webhookApiKeyFieldName]: value } };
    return { bodyFields: { [cfg.webhookApiKeyFieldName]: value } };
  }

  // ── Private: persist delivery log (fire-and-forget, never throws) ───────────

  private async saveLog(log: Omit<MerchantWebhookDeliveryLog, 'deliveredAt'>): Promise<void> {
    try {
      await this.db
        .collection<MerchantWebhookDeliveryLog>(MERCHANT_WEBHOOK_LOG_COLLECTION)
        .insertOne({ ...log, deliveredAt: new Date() } as MerchantWebhookDeliveryLog);
    } catch { /* never block on log failure */ }
  }

  // ── Private: load merchant or throw 404 ────────────────────────────────────

  private async getMerchant(merchantId: string): Promise<MerchantAgreementControlRecord> {
    const merchant = await this.db
      .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
      .findOne({ merchantAgreementInstanceReference: merchantId });
    if (!merchant) throw Object.assign(new Error('Merchant not found'), { statusCode: 404 });
    return merchant;
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async list(merchantId: string): Promise<MerchantWebhookConfig[]> {
    const merchant = await this.getMerchant(merchantId);
    return (merchant.merchantWebhooks ?? []).map(WebhookService.maskSecret);
  }

  async register(
    merchantId: string,
    eventType: WebhookEventType,
    url: string,
    attributeMapping?: Record<string, string>,
    headers?: Record<string, string>,
    apiKeyAuth?: { apiKeyId?: string; apiKeyTransport?: 'header' | 'body'; apiKeyFieldName?: string },
  ): Promise<{ webhook: MerchantWebhookConfig; webhookSecret: string }> {
    const merchant = await this.getMerchant(merchantId);
    const existing = (merchant.merchantWebhooks ?? []).find((w) => w.webhookEventType === eventType);
    const webhookId = existing?.webhookId ?? uuidv4();
    const secret = crypto.randomBytes(32).toString('hex');

    const cfg: MerchantWebhookConfig = {
      webhookId, webhookEventType: eventType, webhookUrl: url,
      webhookSecret: secret, webhookStatus: 'active',
      ...(attributeMapping && Object.keys(attributeMapping).length > 0 ? { webhookAttributeMapping: attributeMapping } : {}),
      ...(headers && Object.keys(headers).length > 0 ? { webhookHeaders: headers } : {}),
      ...(apiKeyAuth?.apiKeyId ? { webhookApiKeyId: apiKeyAuth.apiKeyId, webhookApiKeyTransport: apiKeyAuth.apiKeyTransport, webhookApiKeyFieldName: apiKeyAuth.apiKeyFieldName } : {}),
      webhookCreatedDateTime: existing?.webhookCreatedDateTime ?? new Date(),
    };

    const webhooks = (merchant.merchantWebhooks ?? []).filter((w) => w.webhookEventType !== eventType);
    webhooks.push(cfg);
    await this.db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
      { merchantAgreementInstanceReference: merchantId },
      { $set: { merchantWebhooks: webhooks, recordUpdatedDateTime: new Date() } },
    );
    return { webhook: WebhookService.maskSecret(cfg), webhookSecret: secret };
  }

  async update(
    merchantId: string,
    webhookId: string,
    patch: {
      url?: string;
      status?: 'active' | 'inactive';
      attributeMapping?: Record<string, string>;
      headers?: Record<string, string>;
      apiKeyId?: string | null;
      apiKeyTransport?: 'header' | 'body';
      apiKeyFieldName?: string;
    },
  ): Promise<MerchantWebhookConfig> {
    const merchant = await this.getMerchant(merchantId);
    const idx = (merchant.merchantWebhooks ?? []).findIndex((w) => w.webhookId === webhookId);
    if (idx === -1) throw Object.assign(new Error('Webhook not found'), { statusCode: 404 });

    const webhooks = [...(merchant.merchantWebhooks ?? [])];
    const target = { ...webhooks[idx] };
    if (patch.url) target.webhookUrl = patch.url;
    if (patch.status) target.webhookStatus = patch.status;
    if (patch.attributeMapping !== undefined) target.webhookAttributeMapping = patch.attributeMapping;
    if (patch.headers !== undefined) target.webhookHeaders = patch.headers;
    if ('apiKeyId' in patch) {
      if (patch.apiKeyId) {
        target.webhookApiKeyId = patch.apiKeyId;
        if (patch.apiKeyTransport) target.webhookApiKeyTransport = patch.apiKeyTransport;
        if (patch.apiKeyFieldName) target.webhookApiKeyFieldName = patch.apiKeyFieldName;
      } else {
        delete target.webhookApiKeyId;
        delete target.webhookApiKeyTransport;
        delete target.webhookApiKeyFieldName;
      }
    }
    webhooks[idx] = target;

    await this.db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
      { merchantAgreementInstanceReference: merchantId },
      { $set: { merchantWebhooks: webhooks, recordUpdatedDateTime: new Date() } },
    );
    return WebhookService.maskSecret(target);
  }

  async delete(merchantId: string, webhookId: string): Promise<void> {
    const result = await this.db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
      { merchantAgreementInstanceReference: merchantId },
      { $pull: { merchantWebhooks: { webhookId } } as any, $set: { recordUpdatedDateTime: new Date() } },
    );
    if (result.matchedCount === 0) throw Object.assign(new Error('Merchant not found'), { statusCode: 404 });
  }

  async test(
    merchantId: string,
    webhookId: string,
    customPayload?: Record<string, unknown>,
  ): Promise<WebhookTestResult> {
    const merchant = await this.getMerchant(merchantId);
    const cfg = (merchant.merchantWebhooks ?? []).find((w) => w.webhookId === webhookId);
    if (!cfg) throw Object.assign(new Error('Webhook not found'), { statusCode: 404 });
    if (cfg.webhookStatus !== 'active') {
      throw Object.assign(new Error('Webhook is inactive; activate it before testing'), { statusCode: 400 });
    }

    const raw = customPayload ?? (WebhookService.buildTestPayload(cfg.webhookEventType, merchantId) as Record<string, unknown>);
    const apiKeyAuth = WebhookService.resolveApiKeyAuth(cfg, merchant.merchantApiKeys ?? []);
    const mappedData = {
      ...raw,
      test: true,
      ...(apiKeyAuth.bodyFields ?? {}),
    };
    const mapped = WebhookService.applyBodyMapping(mappedData, cfg.webhookAttributeMapping) as Record<string, unknown>;
    const event = { event: cfg.webhookEventType, timestamp: new Date().toISOString(), data: mapped };

    const result = await deliverWebhook(cfg.webhookUrl, event, cfg.webhookSecret, {
      maxAttempts: 1,
      extraHeaders: { ...(cfg.webhookHeaders ?? {}), ...(apiKeyAuth.extraHeaders ?? {}) },
    });

    const updatedWebhooks = (merchant.merchantWebhooks ?? []).map((w) =>
      w.webhookId === webhookId
        ? { ...w, webhookLastTestedAt: new Date(), webhookLastDeliveryStatus: result.delivered ? ('success' as const) : ('failed' as const), ...(result.error ? { webhookLastDeliveryError: result.error } : {}) }
        : w,
    );
    await this.db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
      { merchantAgreementInstanceReference: merchantId },
      { $set: { merchantWebhooks: updatedWebhooks, recordUpdatedDateTime: new Date() } },
    );

    const payload = JSON.stringify(event);
    const signature = signWebhookPayload(payload, cfg.webhookSecret);

    await this.saveLog({
      logId: uuidv4(),
      merchantAgreementInstanceReference: merchantId,
      webhookId: cfg.webhookId,
      webhookEventType: cfg.webhookEventType,
      deliveryType: 'test',
      requestUrl: cfg.webhookUrl,
      requestHeaders: result.request.headers,
      requestBody: result.request.body,
      responseStatus: result.statusCode,
      responseHeaders: result.response?.headers,
      responseBody: result.response?.body,
      delivered: result.delivered,
      attempts: result.attempts,
      error: result.error,
      signature,
    });

    return {
      delivered: result.delivered,
      statusCode: result.statusCode,
      attempts: result.attempts,
      requestHeaders: result.request.headers,
      requestBody: result.request.body,
      response: result.response,
      error: result.error,
      signature,
    };
  }

  async dispatch(merchantId: string, eventType: WebhookEventType, data: Record<string, unknown>): Promise<void> {
    let merchant: MerchantAgreementControlRecord | null;
    try {
      merchant = await this.db
        .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
        .findOne({ merchantAgreementInstanceReference: merchantId });
    } catch { return; }
    if (!merchant) return;

    const hooks = (merchant.merchantWebhooks ?? []).filter(
      (w) => w.webhookEventType === eventType && w.webhookStatus === 'active',
    );
    if (hooks.length === 0) return;

    const messageId = uuidv4();
    const timestamp = new Date().toISOString();

    for (const cfg of hooks) {
      const apiKeyAuth = WebhookService.resolveApiKeyAuth(cfg, merchant.merchantApiKeys ?? []);
      const mapped = WebhookService.applyBodyMapping(
        { messageId, eventType, timestamp, specVersion: '1.0', data, ...(apiKeyAuth.bodyFields ?? {}) },
        cfg.webhookAttributeMapping,
      );
      const event = { event: eventType, timestamp, data: mapped };

      deliverWebhook(cfg.webhookUrl, event, cfg.webhookSecret, {
        maxAttempts: 3,
        extraHeaders: { ...(cfg.webhookHeaders ?? {}), ...(apiKeyAuth.extraHeaders ?? {}) },
      })
        .then(async (result) => {
          const updatedWebhooks = (merchant!.merchantWebhooks ?? []).map((w) =>
            w.webhookId === cfg.webhookId
              ? { ...w, webhookLastDeliveryStatus: result.delivered ? ('success' as const) : ('failed' as const), ...(result.error ? { webhookLastDeliveryError: result.error } : {}) }
              : w,
          );
          await this.db.collection(MERCHANT_AGREEMENT_COLLECTION).updateOne(
            { merchantAgreementInstanceReference: merchantId },
            { $set: { merchantWebhooks: updatedWebhooks } },
          );
          const sig = signWebhookPayload(JSON.stringify(event), cfg.webhookSecret);
          await this.saveLog({
            logId: uuidv4(),
            merchantAgreementInstanceReference: merchantId,
            webhookId: cfg.webhookId,
            webhookEventType: cfg.webhookEventType,
            deliveryType: 'live',
            requestUrl: cfg.webhookUrl,
            requestHeaders: result.request.headers,
            requestBody: result.request.body,
            responseStatus: result.statusCode,
            responseHeaders: result.response?.headers,
            responseBody: result.response?.body,
            delivered: result.delivered,
            attempts: result.attempts,
            error: result.error,
            signature: sig,
          });

          // Surface OAuth-flow callback delivery on the unified audit ledger (visible to
          // security_auditor/manager) so "did the callback reach the merchant, and if not why" is
          // answerable alongside the login flow. Other webhook types keep only the delivery log above.
          if (eventType.startsWith('oauth.')) {
            const host = (() => { try { return new URL(cfg.webhookUrl).host; } catch { return cfg.webhookUrl; } })();
            emitComplianceEvent(this.db, {
              entityType: 'merchant',
              entityId: merchantId,
              processType: 'authentication',
              processAction: result.delivered ? 'oauth.callback.delivered' : 'oauth.callback.failed',
              processOutcome: result.delivered ? 'verified' : 'failed',
              performedByPartyReference: merchantId,
              performedByRole: 'client',
              eventSummary: {
                eventType, targetHost: host, delivered: result.delivered,
                responseStatus: result.statusCode, attempts: result.attempts,
                ...(result.error ? { failureCause: result.error } : {}),
              },
              bianServiceDomain: 'SD-89 Merchant Notification',
              bianControlRecordType: 'WebhookDelivery',
            });
          }
        })
        .catch(() => { /* never block on delivery failure */ });
    }
  }

  async listLogs(
    merchantId: string,
    filter?: { eventType?: WebhookEventType; deliveryType?: 'live' | 'test'; delivered?: boolean },
    pagination?: { skip?: number; limit?: number },
  ): Promise<{ logs: MerchantWebhookDeliveryLog[]; total: number }> {
    const query: Record<string, unknown> = { merchantAgreementInstanceReference: merchantId };
    if (filter?.eventType) query.webhookEventType = filter.eventType;
    if (filter?.deliveryType) query.deliveryType = filter.deliveryType;
    if (filter?.delivered !== undefined) query.delivered = filter.delivered;
    const col = this.db.collection<MerchantWebhookDeliveryLog>(MERCHANT_WEBHOOK_LOG_COLLECTION);
    const [logs, total] = await Promise.all([
      col.find(query).sort({ deliveredAt: -1 }).skip(pagination?.skip ?? 0).limit(pagination?.limit ?? 25).toArray(),
      col.countDocuments(query),
    ]);
    return { logs, total };
  }
}

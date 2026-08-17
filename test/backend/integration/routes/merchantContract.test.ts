// v37 P0.2 contract baseline for the merchant app and CIBA: endpoints, scope gating, and the
// webhook boundary staying HMAC-SHA256 and pacs.002 aligned (SET is for the bank boundary only).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import { WebhookService } from '../../../../backend/src/modules/gateway/services/merchantWebhook.service';
import { signWebhookPayload, verifyWebhookSignature } from '../../../../backend/src/modules/gateway/services/webhook.service';
import {
  LIVE_READ, buildContractApp, closeContractApp, requireLive, mintOAuthToken, readSeedFile, routeExists, requiredBlocks,
} from '../support/contract';

// Espressoworks, the seeded demo merchant used by merchant/.
const MERCHANT_REF = 'm0000001-0000-4000-8000-000000000001';
const MERCHANT_SUB = 'PTY-MERCHANT-CONTRACT-TEST';

interface MerchantSeed {
  merchantAgreementInstanceReference: string;
  merchantAgreementStatus?: string;
  merchantOAuthClient?: { oauthClientId: string; oauthScopes: string[]; oauthClientStatus: string };
  merchantWebhooks?: unknown[];
}

const MERCHANT_SURFACE: Array<[string, string, string]> = [
  ['GET', '/api/v1/auth/userinfo', '/api/v1/auth/userinfo'],
  ['GET', '/api/v1/accounts', '/api/v1/accounts'],
  ['GET', '/api/v1/transactions', '/api/v1/transactions'],
  ['GET', '/api/v1/beneficiaries', '/api/v1/beneficiaries'],
  ['POST', '/api/v1/beneficiaries', '/api/v1/beneficiaries'],
  ['POST', '/api/v1/beneficiaries/ctp-placeholder/transfer', '/api/v1/beneficiaries/{beneficiaryRef}/transfer'],
  ['DELETE', '/api/v1/beneficiaries/ctp-placeholder', '/api/v1/beneficiaries/{beneficiaryRef}'],
  ['POST', '/api/v1/gateway/payments', '/api/v1/gateway/payments'],
  ['POST', '/api/v1/payment/links', '/api/v1/payment/links'],
  ['POST', '/api/v1/checkout/sessions', '/api/v1/checkout/sessions'],
  ['POST', '/api/v1/gateway/transfers/preview', '/api/v1/gateway/transfers/preview'],
  ['POST', '/api/v1/gateway/transfers/bank', '/api/v1/gateway/transfers/bank'],
  ['POST', '/api/v1/gateway/rtp/requests', '/api/v1/gateway/rtp/requests'],
  ['GET', '/api/v1/gateway/rtp/requests', '/api/v1/gateway/rtp/requests'],
  ['POST', '/api/v1/gateway/rtp/requests/rtp-placeholder/present', '/api/v1/gateway/rtp/requests/{ref}/present'],
  ['POST', '/api/v1/gateway/rtp/requests/rtp-placeholder/accept', '/api/v1/gateway/rtp/requests/{ref}/accept'],
  ['POST', '/api/v1/gateway/rtp/requests/rtp-placeholder/reject', '/api/v1/gateway/rtp/requests/{ref}/reject'],
  ['POST', '/api/v1/gateway/rtp/requests/rtp-placeholder/cancel', '/api/v1/gateway/rtp/requests/{ref}/cancel'],
  ['POST', '/api/v1/gateway/rtp/requests/rtp-placeholder/qr', '/api/v1/gateway/rtp/requests/{ref}/qr'],
];

// CIBA / passwordless, used by both the merchant app (v25) and Leafy Wallet.
const CIBA_SURFACE: Array<[string, string, string]> = [
  ['POST', '/api/v1/auth/bc-authorize', '/api/v1/auth/bc-authorize'],
  ['GET', '/api/v1/auth/bc-authorize/bc-placeholder', '/api/v1/auth/bc-authorize/{authReqId}'],
  ['POST', '/api/v1/auth/bc-authorize/bc-placeholder/approve', '/api/v1/auth/bc-authorize/{authReqId}/approve'],
  ['POST', '/api/v1/auth/bc-authorize/bc-placeholder/deny', '/api/v1/auth/bc-authorize/{authReqId}/deny'],
  ['GET', '/api/v1/auth/bc-authorize/pending', '/api/v1/auth/bc-authorize/pending'],
  ['POST', '/api/v1/auth/enroll/challenge', '/api/v1/auth/enroll/challenge'],
  ['POST', '/api/v1/auth/enroll', '/api/v1/auth/enroll'],
  ['POST', '/api/v1/auth/token', '/api/v1/auth/token'],
  ['GET', '/.well-known/openid-configuration', '/.well-known/openid-configuration'],
];

describe('v37 P0.2: merchant app and CIBA contract baseline', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildContractApp(); });
  afterAll(async () => { await closeContractApp(app); });

  it.each(MERCHANT_SURFACE)('%s %s still resolves', async (method, url, declared) => {
    expect(await routeExists(app, method, url, declared)).toBe(true);
  });

  it.each(CIBA_SURFACE)('CIBA: %s %s still resolves', async (method, url, declared) => {
    expect(await routeExists(app, method, url, declared)).toBe(true);
  });

  it('no merchant-facing route requires an auth domain', () => {
    for (const [, , declared] of [...MERCHANT_SURFACE, ...CIBA_SURFACE]) {
      for (const block of requiredBlocks(app, declared)) expect(block).not.toContain('"domain"');
    }
  });

  it('the merchant OAuth client keeps its RTP scopes', () => {
    const merchants = readSeedFile<MerchantSeed[]>('merchants.json');
    const merchant = merchants.find((m) => m.merchantAgreementInstanceReference === MERCHANT_REF);
    expect(merchant, 'the demo merchant must stay seeded').toBeTruthy();
    expect(merchant!.merchantOAuthClient?.oauthClientStatus).toBe('active');
    for (const scope of ['read:rtp', 'write:rtp', 'write:payments']) {
      expect(merchant!.merchantOAuthClient?.oauthScopes).toContain(scope);
    }
  });

  it('at least one seeded merchant keeps a webhook registration', () => {
    const merchants = readSeedFile<MerchantSeed[]>('merchants.json');
    expect(merchants.some((m) => (m.merchantWebhooks ?? []).length > 0)).toBe(true);
  });

  // ── Webhook boundary: HMAC-SHA256 with a shared secret, not the bank's signed SET ────────────
  it('merchant webhooks stay HMAC-SHA256 signed', () => {
    const signature = signWebhookPayload('{"a":1}', 'secret');
    expect(signature.startsWith('sha256=')).toBe(true);
    expect(verifyWebhookSignature('{"a":1}', signature, 'secret')).toBe(true);
    expect(verifyWebhookSignature('{"a":2}', signature, 'secret')).toBe(false);
  });

  it('the payment webhook payload stays pacs.002 aligned', () => {
    const payload = WebhookService.buildTestPayload('payment.completed', MERCHANT_REF) as {
      messageId: string; eventType: string; timestamp: string; specVersion: string;
      data: Record<string, unknown>;
    };
    expect(payload.eventType).toBe('payment.completed');
    expect(payload.specVersion).toBe('1.0');
    expect(typeof payload.messageId).toBe('string');
    expect(typeof payload.timestamp).toBe('string');
    for (const field of ['transactionReference', 'merchantReference', 'amount', 'status', 'statusCode', 'maskedPan', 'cardToken']) {
      expect(payload.data).toHaveProperty(field);
    }
    // PCI DSS: a webhook carries a masked PAN and a token, never a PAN.
    expect(String(payload.data.maskedPan)).toMatch(/\*|x|X/);
  });

  // ── Live read tier: scope gating on the merchant channel ────────────────────────────────────
  const live = LIVE_READ ? it : it.skip;

  live('a token without the required scope is refused with insufficient_scope', async (ctx) => {
    if (!requireLive(app, ctx)) return;
    const merchants = readSeedFile<MerchantSeed[]>('merchants.json');
    const clientId = merchants
      .find((m) => m.merchantAgreementInstanceReference === MERCHANT_REF)!
      .merchantOAuthClient!.oauthClientId;
    const token = await mintOAuthToken(MERCHANT_SUB, ['read:accounts'], clientId);
    const res = await supertest(app.server)
      .get('/api/v1/beneficiaries')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
  });

  live('a request with no token is refused with 401', async (ctx) => {
    if (!requireLive(app, ctx)) return;
    const res = await supertest(app.server).get('/api/v1/beneficiaries');
    expect(res.status).toBe(401);
  });
});

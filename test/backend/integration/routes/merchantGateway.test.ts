/**
 * Integration tests: v18 final integration fix — merchant OAuth boundary + on-behalf-of gateway.
 * Sources: merchantBeneficiary.controller.ts, merchantPortal.controller.ts, merchantGateway.controller.ts,
 *          vendors/middleware/{auth,validateMerchantToken}.ts
 *
 * Requires TEST_MONGODB_URI env var — skips gracefully when not set (matches merchantActivity.test.ts).
 *
 * Covers:
 *  (a) RS256 OAuth token is now ACCEPTED on merchant beneficiary/portal routes (was 401 by global HS256 mw).
 *  (b) new /merchant/{accounts,transactions,transfers} endpoints:
 *      scope enforcement (403 insufficient_scope), sub-binding (403 on mismatched partyRef),
 *      masked IBAN only (no raw payoutAccountIban), 401 without token.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../backend/bin/server';
import type { FastifyInstance } from 'fastify';
import { getOAuthKeyProvider } from '../../../../backend/src/modules/identity/services/oidcKeys.service';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

const ESPRESSO_CLIENT_ID = 'oauth001-0000-4000-8000-000000000001';
const SUB = 'PTY-MERCHANT-GW-TEST';
const OTHER_SUB = 'PTY-SOMEONE-ELSE';

// Mint a valid RS256 access token exactly like issueTokens() does (aud=clientId, space-delimited scope).
async function mintToken(sub: string, scopes: string[]): Promise<string> {
  const provider = getOAuthKeyProvider();
  const kid = provider.getKid();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: process.env.PSP_BASE_URL ?? 'http://localhost:8081',
    sub,
    aud: ESPRESSO_CLIENT_ID,
    exp: now + 3600,
    iat: now,
    jti: `test-${now}-${Math.random().toString(36).slice(2)}`,
    scope: scopes.join(' '),
    token_type: 'Bearer',
  };
  const headerAndPayload = [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
  ].join('.');
  const sig = await provider.sign(Buffer.from(headerAndPayload));
  return `${headerAndPayload}.${sig.toString('base64url')}`;
}

describe('v18 merchant OAuth boundary + gateway', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    if (SKIP) return;
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI!;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (SKIP) return;
    await app.close();
  });

  // (a) Auth-boundary fix: the RS256 OAuth token reaches validateMerchantToken instead of being 401'd.
  skip('beneficiaries: OAuth token is accepted (not 401 from global HS256 mw)', async () => {
    const token = await mintToken(SUB, ['read:beneficiaries']);
    const res = await supertest(app.server)
      .get(`/api/v1/merchant/beneficiaries/${SUB}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  skip('portal/me: OAuth token accepted with read:merchant_profile', async () => {
    const token = await mintToken(SUB, ['read:merchant_profile']);
    const res = await supertest(app.server)
      .get('/api/v1/merchant/portal/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  // (b) New on-behalf-of gateway endpoints.
  skip('accounts: 200 + masked IBAN only (no raw payoutAccountIban)', async () => {
    const token = await mintToken(SUB, ['read:accounts']);
    const res = await supertest(app.server)
      .get(`/api/v1/merchant/accounts/${SUB}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/"payoutAccountIban"/);
    expect(raw).not.toMatch(/"payoutAccountRoutingNumber"/);
  });

  skip('accounts: sub-binding — mismatched partyRef → 403', async () => {
    const token = await mintToken(SUB, ['read:accounts']);
    const res = await supertest(app.server)
      .get(`/api/v1/merchant/accounts/${OTHER_SUB}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  skip('accounts: missing scope → 403 insufficient_scope', async () => {
    const token = await mintToken(SUB, ['read:beneficiaries']);
    const res = await supertest(app.server)
      .get(`/api/v1/merchant/accounts/${SUB}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
  });

  skip('accounts: no token → 401', async () => {
    const res = await supertest(app.server).get(`/api/v1/merchant/accounts/${SUB}`);
    expect(res.status).toBe(401);
  });

  skip('transactions: 200 with paginated shape and no CHD', async () => {
    const token = await mintToken(SUB, ['read:transactions']);
    const res = await supertest(app.server)
      .get(`/api/v1/merchant/transactions/${SUB}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    const raw = JSON.stringify(res.body).toLowerCase();
    expect(raw).not.toMatch(/"pan"|"cardnumber"|"destinationiban"/);
  });

  skip('transfers/preview: requires write:transfers (403 without it)', async () => {
    const token = await mintToken(SUB, ['read:accounts']);
    const res = await supertest(app.server)
      .post(`/api/v1/merchant/transfers/${SUB}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ destination: { countryCode: 'DE', currency: 'EUR', iban: 'DE89370400440532013000' }, amountCurrency: 'EUR' });
    expect(res.status).toBe(403);
  });

  skip('transfers/preview: 200 with write:transfers', async () => {
    const token = await mintToken(SUB, ['write:transfers']);
    const res = await supertest(app.server)
      .post(`/api/v1/merchant/transfers/${SUB}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ destination: { countryCode: 'DE', currency: 'EUR', iban: 'DE89370400440532013000' }, amountCurrency: 'EUR' });
    expect(res.status).toBe(200);
    expect(typeof res.body.ok).toBe('boolean');
  });
});

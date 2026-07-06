/**
 * Integration tests: v18 Fase D — Authorized Applications (connected apps, self-scoped).
 * Source: backend/src/modules/identity/controllers/consentGrants.controller.ts
 *         (GET /auth/grants/:consentId, GET /auth/grants/:consentId/operations)
 *
 * Requires TEST_MONGODB_URI — skips gracefully when not set (matches the other route tests).
 *
 * Covers:
 *  - D-01 self-scoped access: the OWNER gets 200 with the grant detail (scopes expanded).
 *  - D-01 isolation: another user gets 404 for a grant that is not theirs (existence not leaked).
 *  - D-02 self-scoped operations: owner 200 (paginated, display-safe); non-owner 404.
 *  - No token → 401.
 * A consent grant is inserted directly into partyAuthConsent for the owner and removed afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../backend/bin/server';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

const ESPRESSO_MERCHANT_ID = 'm0000001-0000-4000-8000-000000000001';
const ESPRESSO_CLIENT_ID = 'oauth001-0000-4000-8000-000000000001';
const OWNER_EMAIL = 'julia.santos@back.es';
const OTHER_EMAIL = 'diego.sans@back.es';
const TEST_CONSENT_ID = 'test-consent-fase-d-0000-000000000001';

async function login(app: FastifyInstance, email: string): Promise<{ token: string; sub: string }> {
  const res = await supertest(app.server)
    .post('/api/v1/auth/login')
    .send({ email, password: 'demo-password', domain: 'local' });
  return { token: res.body.token, sub: res.body.user.partyAuthenticationInstanceReference };
}

describe('v18 Fase D: Authorized Applications (self-scoped)', () => {
  let app: FastifyInstance;
  let owner: { token: string; sub: string };
  let other: { token: string; sub: string };

  beforeAll(async () => {
    if (SKIP) return;
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI!;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
    app = await buildApp();
    await app.ready();
    owner = await login(app, OWNER_EMAIL);
    other = await login(app, OTHER_EMAIL);

    // Seed a consent grant owned by `owner` (the endpoints are self-scoped by sub).
    const now = new Date();
    await app.db.collection('partyAuthConsent').insertOne({
      consentId: TEST_CONSENT_ID,
      partyAuthenticationInstanceReference: owner.sub,
      oauthClientId: ESPRESSO_CLIENT_ID,
      merchantAgreementInstanceReference: ESPRESSO_MERCHANT_ID,
      merchantName: 'Espresso Works Ltd',
      grantedScopes: ['openid', 'profile', 'payment:read'],
      consentStatus: 'active',
      consentGrantedAt: now,
      lastUsedAt: now,
      bianServiceDomain: 'PartyAuthentication',
      bianBehaviorQualifier: 'ConsentGrant',
      recordCreatedDateTime: now,
      recordUpdatedDateTime: now,
      schemaVersion: 1,
    } as never);
  });

  afterAll(async () => {
    if (SKIP) return;
    await app.db.collection('partyAuthConsent').deleteOne({ consentId: TEST_CONSENT_ID });
    await app.close();
  });

  skip('detail: owner gets 200 with scopes expanded (D-01)', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/auth/grants/${TEST_CONSENT_ID}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(res.body.consentId).toBe(TEST_CONSENT_ID);
    expect(res.body.merchantName).toBe('Espresso Works Ltd');
    expect(Array.isArray(res.body.grantedScopes)).toBe(true);
    const openid = res.body.grantedScopes.find((s: { scope: string }) => s.scope === 'openid');
    expect(openid).toBeDefined();
    expect(openid.required).toBe(true);
    expect(typeof openid.description).toBe('string');
  });

  skip('detail: another user gets 404 (existence not leaked) (D-01)', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/auth/grants/${TEST_CONSENT_ID}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(404);
  });

  skip('detail: no token → 401', async () => {
    const res = await supertest(app.server).get(`/api/v1/auth/grants/${TEST_CONSENT_ID}`);
    expect(res.status).toBe(401);
  });

  skip('operations: owner gets 200 with paginated, display-safe shape (D-02)', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/auth/grants/${TEST_CONSENT_ID}/operations`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    const raw = JSON.stringify(res.body).toLowerCase();
    expect(raw).not.toMatch(/"pan"|"iban"|"cardnumber"/);
  });

  skip('operations: another user gets 404 (D-02)', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/auth/grants/${TEST_CONSENT_ID}/operations`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(404);
  });
});

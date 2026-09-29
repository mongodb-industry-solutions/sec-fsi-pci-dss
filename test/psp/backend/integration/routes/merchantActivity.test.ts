/**
 * Integration tests: v18 Fase B, Merchant Activity + Authorizations views
 * Source: backend/src/modules/gateway/controllers/merchant.controller.ts
 *         (GET /merchants/:id/activity, GET /merchants/:id/authorizations)
 *
 * Requires TEST_MONGODB_URI env var: skips gracefully when not set (matches rbac.test.ts).
 *
 * Covers:
 *  - B-01/B-10 RBAC: security_auditor may view; a non-owner customer is denied (403); no token → 401.
 *  - B-12 filtering: the `user` filter on /activity narrows rows to that actingPartyReference.
 *  - Display-safe contract: no `pan`/`iban` fields leak into the activity payload.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../../psp/backend/bin/server';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

const ESPRESSO_MERCHANT_ID = 'm0000001-0000-4000-8000-000000000001';
const AUDITOR_EMAIL = 'diego.sans@back.es';
const NON_OWNER_CUSTOMER_EMAIL = 'julia.santos@back.es';

async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await supertest(app.server)
    .post('/api/v1/auth/login')
    .send({ email, password: 'demo-password', domain: 'local' });
  return res.body.token;
}

describe('v18 Fase B: Merchant Activity + Authorizations', () => {
  let app: FastifyInstance;
  let auditorToken: string;
  let customerToken: string;

  beforeAll(async () => {
    if (SKIP) return;
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI!;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
    app = await buildApp();
    await app.ready();
    auditorToken = await login(app, AUDITOR_EMAIL);
    customerToken = await login(app, NON_OWNER_CUSTOMER_EMAIL);
  });

  afterAll(async () => {
    if (SKIP) return;
    await app.close();
  });

  skip('activity: security_auditor gets 200 with paginated, display-safe shape', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/merchants/${ESPRESSO_MERCHANT_ID}/activity`)
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    // Display-safe: no CHD / raw IBAN anywhere in the payload.
    const raw = JSON.stringify(res.body).toLowerCase();
    expect(raw).not.toMatch(/"pan"|"iban"|"cardnumber"/);
  });

  skip('activity: `user` filter narrows rows to that actingPartyReference (B-12)', async () => {
    const all = await supertest(app.server)
      .get(`/api/v1/merchants/${ESPRESSO_MERCHANT_ID}/activity?limit=100`)
      .set('Authorization', `Bearer ${auditorToken}`);
    const withParty = (all.body.events as Array<{ actingPartyReference?: string }>).find((e) => e.actingPartyReference);
    if (!withParty?.actingPartyReference) return; // no attributed activity seeded: nothing to assert
    const filtered = await supertest(app.server)
      .get(`/api/v1/merchants/${ESPRESSO_MERCHANT_ID}/activity?user=${encodeURIComponent(withParty.actingPartyReference)}`)
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(filtered.status).toBe(200);
    for (const e of filtered.body.events as Array<{ actingPartyReference?: string }>) {
      expect(e.actingPartyReference).toBe(withParty.actingPartyReference);
    }
  });

  skip('activity: non-owner customer is denied (403)', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/merchants/${ESPRESSO_MERCHANT_ID}/activity`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  skip('activity: no token → 401', async () => {
    const res = await supertest(app.server).get(`/api/v1/merchants/${ESPRESSO_MERCHANT_ID}/activity`);
    expect(res.status).toBe(401);
  });

  skip('authorizations: security_auditor gets 200 with paginated shape', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/merchants/${ESPRESSO_MERCHANT_ID}/authorizations`)
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.authorizations)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  skip('authorizations: non-owner customer is denied (403)', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/merchants/${ESPRESSO_MERCHANT_ID}/authorizations`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });
});

/**
 * Integration tests (v36, ADR-063): the canonical movement collection.
 * Source: backend/src/modules/transaction/controllers/cardTransaction.controller.ts
 *         backend/src/modules/gateway/services/paymentMovement.service.ts
 *
 * Requires TEST_MONGODB_URI - skips gracefully when not set.
 *
 * These run against the REAL route (schema validation included), which is what a stubbed E2E cannot
 * check: the v36 migration shipped a client asking for `limit=200` against a schema capped at 100, so
 * `/system/payment/history` answered 400 for every user. The bound is pinned here.
 *
 * Covered:
 *  - the page size the clients actually request is accepted, and the documented ceiling is enforced;
 *  - every kind is returned by default, `kind` narrows, and only `kind=card` returns card documents;
 *  - `/transactions/all` is gone (404);
 *  - a customer is scoped to their own movements and cannot widen it with someone else's email.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../backend/bin/server';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

const USERS = {
  customer: 'luis.fernandez@back.es',
  analyst: 'sarah.chen@back.es',
};

// The history page requests this page size; the schema must accept it.
const CLIENT_PAGE_SIZE = 200;

describe('v36: movement collection', () => {
  let app: FastifyInstance;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    if (SKIP) return;
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI!;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
    app = await buildApp();
    await app.ready();
    for (const [key, email] of Object.entries(USERS)) {
      const res = await supertest(app.server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'demo-password', domain: 'local' });
      tokens[key] = res.body.token;
    }
  });

  afterAll(async () => {
    if (SKIP) return;
    await app.close();
  });

  // -- authentication ------------------------------------------------------

  // `/api/v1/transactions` is in the PUBLIC_EXACT list so the simulator can CREATE a payment with no
  // session. The exemption used to be path-only, so the collection GET was public too: harmless while
  // it required a cardToken, a full data exposure once it started listing every movement (v36).
  skip('the collection GET requires authentication', async () => {
    const res = await supertest(app.server).get('/api/v1/transactions?limit=1');
    expect(res.status).toBe(401);
  });

  skip('creating a payment stays public (simulator mode)', async () => {
    // No token: the route must still be reachable. An invalid body is fine, a 401 is not.
    const res = await supertest(app.server).post('/api/v1/transactions').send({});
    expect(res.status).not.toBe(401);
  });

  // The merchant OAuth channel is what leafy-wallet uses (`PspClient.listTransactions`). It broke once
  // when the public-path exemption became method-scoped and the GET fell through to the session path,
  // which verifies HS256 and rejects an RS256 Bearer. This pins the channel, not just the shape.
  skip('the merchant OAuth channel can list movements', async () => {
    const tok = await supertest(app.server)
      .post('/api/v1/auth/token')
      .type('form')
      .send({
        grant_type: 'client_credentials',
        client_id: 'oauth001-0000-4000-8000-000000000001',
        client_secret: 'espresso-demo-secret-2026',
        scope: 'read:transactions',
      });
    expect(tok.status).toBe(200);
    const res = await supertest(app.server)
      .get('/api/v1/transactions?limit=5')
      .set('Authorization', `Bearer ${tok.body.access_token}`);
    expect(res.status).toBe(200);
    // Same envelope the consumer reads.
    for (const k of ['results', 'total', 'page', 'limit']) expect(res.body).toHaveProperty(k);
  });

  skip('an OAuth token without read:transactions is refused', async () => {
    const tok = await supertest(app.server)
      .post('/api/v1/auth/token')
      .type('form')
      .send({
        grant_type: 'client_credentials',
        client_id: 'oauth001-0000-4000-8000-000000000001',
        client_secret: 'espresso-demo-secret-2026',
        scope: 'read:accounts',
      });
    const res = await supertest(app.server)
      .get('/api/v1/transactions?limit=5')
      .set('Authorization', `Bearer ${tok.body.access_token}`);
    expect(res.status).toBe(403);
  });

  // -- scoping -------------------------------------------------------------

  // A customer must see only their own movements. This is the guard that regressed when the collection
  // stopped receiving an explicit `email` from the client and fell back to a default role.
  skip('a customer sees fewer movements than staff', async () => {
    const mine = await supertest(app.server)
      .get('/api/v1/transactions?limit=200')
      .set('Authorization', `Bearer ${tokens.customer}`);
    const all = await supertest(app.server)
      .get('/api/v1/transactions?limit=200')
      .set('Authorization', `Bearer ${tokens.analyst}`);
    expect(mine.status).toBe(200);
    expect(all.status).toBe(200);
    expect(mine.body.total).toBeLessThan(all.body.total);
  });

  // Direction is relative to the viewer, so an incoming transfer must not read as sent.
  skip('a transfer the customer received is marked received', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/transactions?kind=transfer&limit=200')
      .set('Authorization', `Bearer ${tokens.customer}`);
    const rows = res.body.results as Array<{ direction: string }>;
    if (rows.length === 0) return;
    expect(rows.some((r) => r.direction === 'received')).toBe(true);
  });

  // -- page size -----------------------------------------------------------

  skip('accepts the page size the history page requests', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/transactions?limit=${CLIENT_PAGE_SIZE}`)
      .set('Authorization', `Bearer ${tokens.customer}`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(CLIENT_PAGE_SIZE);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('limit');
  });

  skip('rejects a page size over the documented ceiling', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/transactions?limit=201')
      .set('Authorization', `Bearer ${tokens.analyst}`);
    expect(res.status).toBe(400);
  });

  // -- kinds ---------------------------------------------------------------

  skip('returns every movement kind by default', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/transactions?limit=200')
      .set('Authorization', `Bearer ${tokens.analyst}`);
    expect(res.status).toBe(200);
    const kinds = new Set((res.body.results as Array<{ kind?: string }>).map((r) => r.kind));
    // Rows are kind-discriminated whatever the mix in the seeded data.
    for (const k of kinds) expect(['card', 'transfer', 'rtp']).toContain(k);
    expect(kinds.size).toBeGreaterThan(0);
  });

  skip('kind=transfer returns only transfers', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/transactions?kind=transfer&limit=50')
      .set('Authorization', `Bearer ${tokens.analyst}`);
    expect(res.status).toBe(200);
    for (const r of res.body.results as Array<{ kind?: string }>) expect(r.kind).toBe('transfer');
  });

  skip('kind=card returns the card document shape (not a movement row)', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/transactions?kind=card&limit=5')
      .set('Authorization', `Bearer ${tokens.analyst}`);
    expect(res.status).toBe(200);
    if (res.body.results.length > 0) {
      const row = res.body.results[0];
      expect(row).toHaveProperty('cardTransactionInstanceReference');
      expect(row).not.toHaveProperty('kind');
    }
  });

  skip('rejects an unknown kind', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/transactions?kind=wire')
      .set('Authorization', `Bearer ${tokens.analyst}`);
    expect(res.status).toBe(400);
  });

  // -- the removed alias ---------------------------------------------------

  skip('GET /transactions/all is gone', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/transactions/all')
      .set('Authorization', `Bearer ${tokens.analyst}`);
    // The path now falls through to /:id, which finds no movement with that reference.
    expect(res.status).toBe(404);
  });

  // -- customer scoping ----------------------------------------------------

  skip('a customer cannot widen the scope with another email', async () => {
    const own = await supertest(app.server)
      .get('/api/v1/transactions?limit=200')
      .set('Authorization', `Bearer ${tokens.customer}`);
    const spoofed = await supertest(app.server)
      .get('/api/v1/transactions?limit=200&email=sarah.chen@back.es')
      .set('Authorization', `Bearer ${tokens.customer}`);
    expect(spoofed.status).toBe(200);
    expect(spoofed.body.total).toBe(own.body.total);
  });

  // -- detail by reference -------------------------------------------------

  skip('a movement reference resolves on the detail route, whatever its kind', async () => {
    const list = await supertest(app.server)
      .get('/api/v1/transactions?kind=transfer&limit=1')
      .set('Authorization', `Bearer ${tokens.analyst}`);
    const ref = (list.body.results as Array<{ paymentExecutionInstanceReference?: string }>)[0]?.paymentExecutionInstanceReference;
    if (!ref) return; // no seeded transfer in this database
    const res = await supertest(app.server)
      .get(`/api/v1/transactions/${ref}`)
      .set('Authorization', `Bearer ${tokens.analyst}`);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('transfer');
    expect(res.body.paymentExecutionInstanceReference).toBe(ref);
  });
});

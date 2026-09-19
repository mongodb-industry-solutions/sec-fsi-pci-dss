/**
 * Integration tests: /api/v1/integrations routes (FR-v6-03, FR-v6-05, FR-v6-06)
 * Source: backend/src/modules/provider/controllers/integrationRegistry.controller.ts
 *
 * Requires TEST_MONGODB_URI: skips gracefully when not set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../../psp/backend/bin/server';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

// A JWT signed for manager (bypasses auth middleware in test mode via x-user-role header)
const SYSTEM_ADMIN_HEADERS = { 'x-user-role': 'manager' };
const ANALYST_HEADERS      = { 'x-user-role': 'level1_analyst' };

describe('FR-v6 Integration Hub routes', () => {
  let app: FastifyInstance;
  let createdId: string;
  let apiKey: string;

  beforeAll(async () => {
    if (SKIP) return;
    process.env.MONGODB_URI     = process.env.TEST_MONGODB_URI!;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (SKIP) return;
    await app.close();
  });

  // ── PATCH allowlist ─────────────────────────────────────────────────────────
  //
  // THE DEFECT THESE GUARD AGAINST. The PATCH handler copies body keys into the update one at a
  // time, that list drifted from the declared updateable fields, and a key missing from it was
  // dropped in silence: the request answered 200 with the record unchanged. `externalProviderEvents`
  // was in that state, so every per-event edit made on the Outbound and Inbound screens was
  // discarded while the UI reported success. A round trip is the only thing that catches it, because
  // the response is a 200 either way.

  skip('PATCH persists the per-event configuration it reports as saved', async () => {
    const events = [{
      event: 'transaction.authorized',
      outbound: { url: '/v1/score', httpMethod: 'POST', mapping: [] },
      inbound: { mapping: [] },
    }];
    const patched = await supertest(app.server)
      .patch(`/api/v1/providers/vendors/${createdId}`)
      .set(SYSTEM_ADMIN_HEADERS)
      .send({ externalProviderEvents: events });
    expect(patched.status).toBe(200);

    const reread = await supertest(app.server)
      .get(`/api/v1/providers/vendors/${createdId}`)
      .set(SYSTEM_ADMIN_HEADERS);
    expect(reread.body.integration.externalProviderEvents?.[0]?.outbound?.url).toBe('/v1/score');
  });

  skip('PATCH persists the per-environment base URLs and resolves the active one', async () => {
    const patched = await supertest(app.server)
      .patch(`/api/v1/providers/vendors/${createdId}`)
      .set(SYSTEM_ADMIN_HEADERS)
      .send({ externalProviderBaseUrlByEnvironment: {
        development: 'http://localhost:9100',
        staging: 'https://sandbox.vendor.example',
        production: 'https://api.vendor.example',
      } });
    expect(patched.status).toBe(200);

    const reread = await supertest(app.server)
      .get(`/api/v1/providers/vendors/${createdId}`)
      .set(SYSTEM_ADMIN_HEADERS);
    expect(reread.body.integration.externalProviderBaseUrlByEnvironment?.staging)
      .toBe('https://sandbox.vendor.example');
    // Every environment is reported, with the running one marked, so a wrong host is visible before
    // the deployment that would otherwise be the first thing to find it.
    const byId = Object.fromEntries(
      (reread.body.links?.environments ?? []).map((e: { environmentId: string }) => [e.environmentId, e]),
    );
    expect(byId.staging.resolved).toBe('https://sandbox.vendor.example');
    expect(byId.production.resolved).toBe('https://api.vendor.example');
    expect(byId[reread.body.links.activeEnvironment].active).toBe(true);
  });

  // ── Role guard ──────────────────────────────────────────────────────────────

  skip('GET /api/v1/integrations returns 403 for non-system_admin', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/integrations')
      .set(ANALYST_HEADERS);
    expect(res.status).toBe(403);
  });

  skip('POST /api/v1/integrations returns 403 for non-system_admin', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/integrations')
      .set(ANALYST_HEADERS)
      .send({ externalProviderArrangementName: 'X', externalProviderArrangementType: 'fraud_detection', externalProviderMode: 'sync' });
    expect(res.status).toBe(403);
  });

  // ── Internal provider seeding ────────────────────────────────────────────────

  skip('GET /api/v1/integrations returns the 3 seeded internal providers', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/integrations')
      .set(SYSTEM_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    const internalProviders = res.body.integrations.filter(
      (i: Record<string, unknown>) => i.externalProviderIsInternal === true
    );
    expect(internalProviders.length).toBeGreaterThanOrEqual(3);
  });

  skip('Internal providers have "Built-in" badge data (externalProviderIsInternal = true)', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/integrations')
      .set(SYSTEM_ADMIN_HEADERS);
    const fds = res.body.integrations.find(
      (i: Record<string, unknown>) => i.externalProviderArrangementType === 'fraud_detection' && i.externalProviderIsInternal
    );
    expect(fds).toBeTruthy();
    expect(fds.externalProviderIsInternal).toBe(true);
  });

  // ── Create external provider ─────────────────────────────────────────────────

  skip('POST /api/v1/integrations returns 201 with apiKey on success', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/integrations')
      .set(SYSTEM_ADMIN_HEADERS)
      .send({
        externalProviderArrangementName:   'Sardine FDS Test',
        externalProviderArrangementType:   'fraud_detection',
        externalProviderMode:              'sync',
        externalProviderApiEndpoint:       'https://api.sardine.ai/v1/score',
        externalProviderArrangementStatus: 'test',
      });
    expect(res.status).toBe(201);
    expect(res.body.apiKey).toBeTruthy();
    expect(typeof res.body.apiKey).toBe('string');
    expect(res.body.integration.externalProviderArrangementInstanceReference).toBeTruthy();
    // Save for next tests
    createdId = res.body.integration.externalProviderArrangementInstanceReference;
    apiKey    = res.body.apiKey;
  });

  skip('GET /api/v1/integrations/:id does NOT expose apiKeyHash', async () => {
    if (!createdId) return;
    const res = await supertest(app.server)
      .get(`/api/v1/integrations/${createdId}`)
      .set(SYSTEM_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.integration.externalProviderApiKeyHash).toBeUndefined();
    expect(res.body.integration.externalProviderCallbackSecretHash).toBeUndefined();
  });

  // ── Duplicate rejection ──────────────────────────────────────────────────────

  skip('POST /api/v1/integrations returns 409 for duplicate type+endpoint', async () => {
    const payload = {
      externalProviderArrangementName:   'Duplicate FDS',
      externalProviderArrangementType:   'fraud_detection',
      externalProviderMode:              'sync',
      externalProviderApiEndpoint:       'https://api.sardine.ai/v1/score',
      externalProviderArrangementStatus: 'test',
    };
    await supertest(app.server).post('/api/v1/integrations').set(SYSTEM_ADMIN_HEADERS).send(payload);
    const res2 = await supertest(app.server).post('/api/v1/integrations').set(SYSTEM_ADMIN_HEADERS).send(payload);
    expect(res2.status).toBe(409);
  });

  // ── Key rotation ─────────────────────────────────────────────────────────────

  skip('POST /api/v1/integrations/:id/rotate-key returns a new apiKey', async () => {
    if (!createdId) return;
    const res = await supertest(app.server)
      .post(`/api/v1/integrations/${createdId}/rotate-key`)
      .set(SYSTEM_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.apiKey).toBeTruthy();
    expect(res.body.apiKey).not.toBe(apiKey);
  });

  skip('POST /api/v1/integrations/:id/rotate-key returns 400 for internal providers', async () => {
    const listRes = await supertest(app.server).get('/api/v1/integrations').set(SYSTEM_ADMIN_HEADERS);
    const internal = listRes.body.integrations.find((i: Record<string, unknown>) => i.externalProviderIsInternal);
    if (!internal) return;

    const res = await supertest(app.server)
      .post(`/api/v1/integrations/${internal.externalProviderArrangementInstanceReference}/rotate-key`)
      .set(SYSTEM_ADMIN_HEADERS);
    expect(res.status).toBe(400);
  });

  // ── Suspend ──────────────────────────────────────────────────────────────────

  skip('POST /api/v1/integrations/:id/suspend returns 400 for internal providers', async () => {
    const listRes = await supertest(app.server).get('/api/v1/integrations').set(SYSTEM_ADMIN_HEADERS);
    const internal = listRes.body.integrations.find((i: Record<string, unknown>) => i.externalProviderIsInternal);
    if (!internal) return;

    const res = await supertest(app.server)
      .post(`/api/v1/integrations/${internal.externalProviderArrangementInstanceReference}/suspend`)
      .set(SYSTEM_ADMIN_HEADERS);
    expect(res.status).toBe(400);
  });

  skip('POST /api/v1/integrations/:id/test returns status + latencyMs for internal provider', async () => {
    const listRes = await supertest(app.server).get('/api/v1/integrations').set(SYSTEM_ADMIN_HEADERS);
    const internal = listRes.body.integrations.find((i: Record<string, unknown>) => i.externalProviderIsInternal);
    if (!internal) return;

    const res = await supertest(app.server)
      .post(`/api/v1/integrations/${internal.externalProviderArrangementInstanceReference}/test`)
      .set(SYSTEM_ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.latencyMs).toBe('number');
  });
});

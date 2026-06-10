/**
 * Integration tests: /api/v1/integrations routes (FR-v6-03, FR-v6-05, FR-v6-06)
 * Source: backend/src/modules/integrations/controllers/integrationRegistry.controller.ts
 *
 * Requires TEST_MONGODB_URI — skips gracefully when not set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../backend/src/server';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

// A JWT signed for system_admin (bypasses auth middleware in test mode via x-demo-role header)
const SYSTEM_ADMIN_HEADERS = { 'x-demo-role': 'system_admin' };
const ANALYST_HEADERS      = { 'x-demo-role': 'level1_analyst' };

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

/**
 * Integration tests: /api/v1/events routes RBAC (ADR-025 / F7.3)
 * Source: backend/src/modules/provider/controllers/processEvent.controller.ts
 *
 * Requires TEST_MONGODB_URI env var — skips gracefully when not set.
 * Spins up a real Fastify app against a seeded test Atlas cluster.
 *
 * Acceptance criteria (roadmap.md §v7):
 *   FR-v7-03.1  security_auditor can list businessProcessEvents → 200
 *   FR-v7-03.2  manager can list businessProcessEvents → 200
 *   FR-v7-03.3  level1_analyst is denied → 403
 *   FR-v7-03.4  unauthenticated request → 401
 *   FR-v7-03.5  manager can list complianceProcessEvents → 200
 *   FR-v7-03.6  x-user-role override with valid JWT sets effective role
 *   FR-v7-03.7  pagination params (page, limit) are respected
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../backend/bin/server';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

describe('ADR-025: /api/v1/events routes — RBAC', () => {
  let app: FastifyInstance;
  // JWT for level1_analyst (sarah.chen@back.es)
  let analystToken: string;
  // JWT for security_auditor (diego.sans@back.es)
  let auditorToken: string;

  beforeAll(async () => {
    if (SKIP) return;
    process.env.MONGODB_URI     = process.env.TEST_MONGODB_URI!;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
    app = await buildApp();
    await app.ready();

    const l1Res = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'sarah.chen@back.es', password: 'demo-password', domain: 'local' });
    analystToken = l1Res.body.token;

    const auditRes = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'diego.sans@back.es', password: 'demo-password', domain: 'local' });
    auditorToken = auditRes.body.token;
  });

  afterAll(async () => {
    if (SKIP) return;
    await app.close();
  });

  // ── Authentication guard ────────────────────────────────────────────────────

  skip('FR-v7-03.4: GET /events/process returns 401 without Authorization header', async () => {
    const res = await supertest(app.server).get('/api/v1/events/process');
    expect(res.status).toBe(401);
  });

  skip('FR-v7-03.4: GET /events/compliance returns 401 without Authorization header', async () => {
    const res = await supertest(app.server).get('/api/v1/events/compliance');
    expect(res.status).toBe(401);
  });

  // ── Role guard: /events/process ─────────────────────────────────────────────

  skip('FR-v7-03.3: GET /events/process returns 403 for level1_analyst', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/events/process')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  skip('FR-v7-03.1: GET /events/process returns 200 for security_auditor', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/events/process')
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.page).toBe('number');
    expect(typeof res.body.limit).toBe('number');
  });

  skip('FR-v7-03.2: GET /events/process returns 200 for manager role (x-user-role override)', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/events/process')
      .set('Authorization', `Bearer ${analystToken}`)
      .set('x-user-role', 'manager');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  // ── Role guard: /events/compliance ─────────────────────────────────────────

  skip('FR-v7-03.3: GET /events/compliance returns 403 for level1_analyst', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/events/compliance')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  skip('FR-v7-03.5: GET /events/compliance returns 200 for security_auditor', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/events/compliance')
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  skip('FR-v7-03.5: GET /events/compliance returns 200 for manager role', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/events/compliance')
      .set('Authorization', `Bearer ${analystToken}`)
      .set('x-user-role', 'manager');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  // ── Pagination ──────────────────────────────────────────────────────────────

  skip('FR-v7-03.7: GET /events/process respects page and limit params', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/events/process?page=1&limit=5')
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(5);
    expect(res.body.events.length).toBeLessThanOrEqual(5);
  });

  // ── Entity-scoped routes ────────────────────────────────────────────────────

  skip('GET /events/process/:entityType/:entityId returns 200 for security_auditor', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/events/process/transaction/txn-nonexistent')
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.total).toBe(0);
  });

  skip('GET /events/process/:entityType/:entityId returns 403 for level1_analyst', async () => {
    const res = await supertest(app.server)
      .get('/api/v1/events/process/transaction/txn-nonexistent')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });
});

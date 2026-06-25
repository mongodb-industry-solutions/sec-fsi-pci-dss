/**
 * Integration tests: auth routes (FR-v1-05)
 * Source: backend/src/controllers/auth.controller.ts
 *
 * Requires TEST_MONGODB_URI env var - skips gracefully when not set.
 * This test spins up a real Fastify app against a test Atlas cluster.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../backend/bin/server';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

describe('FR-v1-05: Auth routes', () => {
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

  skip('POST /api/v1/auth/login returns 200 + JWT for valid credentials', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'sarah.chen@back.es', password: 'demo-password', domain: 'local' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('level1_analyst');
  });

  skip('POST /api/v1/auth/login returns 401 for wrong password', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'sarah.chen@back.es', password: 'wrong', domain: 'local' });
    expect(res.status).toBe(401);
  });

  skip('POST /api/v1/auth/login returns 401 for unknown user', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@back.es', password: 'demo-password', domain: 'local' });
    expect(res.status).toBe(401);
  });

  skip('GET /api/v1/auth/users returns user list without password hashes', async () => {
    const res = await supertest(app.server).get('/api/v1/auth/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    for (const user of res.body.users) {
      expect(user.partyAuthenticationCredentialHash).toBeUndefined();
      expect(user.email).toBeTruthy();
    }
  });

  skip('Protected endpoint returns 401 without token', async () => {
    const res = await supertest(app.server).get('/api/v1/fraud-diagnosis-cases');
    expect(res.status).toBe(401);
  });

  skip('GET /health is public (no auth required)', async () => {
    const res = await supertest(app.server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

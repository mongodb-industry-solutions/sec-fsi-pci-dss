/**
 * Integration tests: RBAC API Layer (FR-v2-13)
 * Source: backend/src/vendors/middleware/rbac.ts + customerAgreement.controller.ts
 *
 * Requires TEST_MONGODB_URI env var - skips gracefully when not set.
 * Spins up a real Fastify app against a seeded test Atlas cluster.
 *
 * Acceptance criteria:
 * FR-v2-13.1  Missing X-User-Role defaults to level1_analyst
 * FR-v2-13.2  L1 gets customer data without sensitive block
 * FR-v2-13.3  L2 without escalation token → 403
 * FR-v2-13.3  L2 with valid escalation token → 200 with sensitive block
 * NFR-v2-02   Forged X-User-Role: level2_investigator without token → 403
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../backend/src/server';
import { generateToken, _clearStore } from '../../../../backend/src/vendors/security/escalationTokens';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

const TEST_EMAIL = 'sarah.chen@back.es';
const TEST_CASE_ID = 'test-case-fr-v2-13';

describe('FR-v2-13: RBAC API Layer', () => {
  let app: FastifyInstance;
  let l1Token: string;
  let l2Token: string;

  beforeAll(async () => {
    if (SKIP) return;
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI!;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
    app = await buildApp();
    await app.ready();

    // Obtain JWT tokens for L1 and L2 demo users
    const l1Res = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'sarah.chen@back.es', password: 'demo-password', domain: 'local' });
    l1Token = l1Res.body.token;

    const l2Res = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({ email: 'michael.obi@back.es', password: 'demo-password', domain: 'local' });
    l2Token = l2Res.body.token;
  });

  afterAll(async () => {
    if (SKIP) return;
    _clearStore();
    await app.close();
  });

  skip('FR-v2-13.1: missing X-User-Role defaults to level1_analyst (no sensitive block)', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/customer-agreements?email=${encodeURIComponent(TEST_EMAIL)}`)
      .set('Authorization', `Bearer ${l1Token}`);
    expect(res.status).toBe(200);
    expect(res.body.sensitive).toBeUndefined();
  });

  skip('FR-v2-13.2: L1 role returns customer data without sensitive block', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/customer-agreements?email=${encodeURIComponent(TEST_EMAIL)}`)
      .set('Authorization', `Bearer ${l1Token}`)
      .set('X-User-Role', 'level1_analyst');
    expect(res.status).toBe(200);
    expect(res.body.customerName).toBeTruthy();
    expect(res.body.sensitive).toBeUndefined();
  });

  skip('FR-v2-13.3: L2 without escalation token returns 403', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/customer-agreements?email=${encodeURIComponent(TEST_EMAIL)}`)
      .set('Authorization', `Bearer ${l2Token}`)
      .set('X-User-Role', 'level2_investigator');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/escalation token/i);
  });

  skip('NFR-v2-02: forged X-User-Role level2_investigator without token → 403', async () => {
    // L1 user's JWT, but header claims L2 - must still be blocked without token
    const res = await supertest(app.server)
      .get(`/api/v1/customer-agreements?email=${encodeURIComponent(TEST_EMAIL)}`)
      .set('Authorization', `Bearer ${l1Token}`)
      .set('X-User-Role', 'level2_investigator');
    expect(res.status).toBe(403);
  });

  skip('FR-v2-13.3: L2 with valid escalation token returns 200 with sensitive block', async () => {
    const escalationToken = generateToken(TEST_CASE_ID, 'level2_investigator');
    const res = await supertest(app.server)
      .get(`/api/v1/customer-agreements?email=${encodeURIComponent(TEST_EMAIL)}`)
      .set('Authorization', `Bearer ${l2Token}`)
      .set('X-User-Role', 'level2_investigator')
      .set('X-Escalation-Token', escalationToken);
    expect(res.status).toBe(200);
    expect(res.body.sensitive).toBeDefined();
    expect(res.body.sensitive.governmentIdentificationReference).toBeTruthy();
    expect(res.body.sensitive.customerAgreementResidentialAddress).toBeDefined();
  });
});

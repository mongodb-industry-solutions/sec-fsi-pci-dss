/**
 * Integration tests: /webhooks/* callback routes (FR-v6-09, FR-v6-10)
 * Source: backend/src/modules/provider/controllers/integrationWebhook.controller.ts
 *
 * Requires TEST_MONGODB_URI: skips gracefully when not set.
 * HMAC tests validate the verifyHmacSignature utility directly (unit-level).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import supertest from 'supertest';
import { buildApp } from '../../../../backend/bin/server';
import type { FastifyInstance } from 'fastify';
import {
  verifyHmacSignature,
} from '../../../../backend/src/modules/provider/services/integrationCallback.service';

// ── HMAC utility unit tests (no DB, no server required) ─────────────────────

describe('verifyHmacSignature', () => {
  const secret = 'test-secret-key';
  const body = JSON.stringify({ event: 'fraud.scored', score: 87 });

  it('returns true for a correct HMAC-SHA256 signature', () => {
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyHmacSignature(secret, body, sig)).toBe(true);
  });

  it('returns false for a wrong HMAC', () => {
    expect(verifyHmacSignature(secret, body, 'sha256=deadbeef')).toBe(false);
  });

  it('returns false when signature header is missing (empty string)', () => {
    expect(verifyHmacSignature(secret, body, '')).toBe(false);
  });

  it('returns false for a signature without the sha256= prefix', () => {
    const raw = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyHmacSignature(secret, body, raw)).toBe(false);
  });

  it('is timing-safe: does not throw for mismatched buffer lengths', () => {
    expect(() => verifyHmacSignature(secret, body, 'sha256=ab')).not.toThrow();
  });
});

// ── Route integration tests (require TEST_MONGODB_URI) ──────────────────────

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

describe('FR-v6 Webhook callback routes', () => {
  let app: FastifyInstance;

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

  skip('POST /webhooks/fds/:id/callback returns 401 when X-Webhook-Signature is missing', async () => {
    const res = await supertest(app.server)
      .post('/webhooks/fds/int-internal-fds-001/callback')
      .send({ event: 'test' });
    expect(res.status).toBe(401);
  });

  skip('POST /webhooks/fds/:id/callback returns 401 for an invalid HMAC signature', async () => {
    const res = await supertest(app.server)
      .post('/webhooks/fds/int-internal-fds-001/callback')
      .set('X-Webhook-Signature', 'sha256=invalid')
      .send({ event: 'test' });
    expect(res.status).toBe(401);
  });

  skip('POST /webhooks/aml/:id/callback returns 401 when X-Webhook-Signature is missing', async () => {
    const res = await supertest(app.server)
      .post('/webhooks/aml/int-internal-aml-001/callback')
      .send({ event: 'test' });
    expect(res.status).toBe(401);
  });

  skip('POST /webhooks/fds/:id/callback returns 200 for a valid HMAC signature against an internal provider', async () => {
    // Internal providers use arrangementId as demo secret
    const arrangementId = 'int-internal-fds-001';
    const body = JSON.stringify({ event: 'fraud.scored', score: 75 });
    const sig = 'sha256=' + createHmac('sha256', arrangementId).update(body).digest('hex');

    const res = await supertest(app.server)
      .post(`/webhooks/fds/${arrangementId}/callback`)
      .set('X-Webhook-Signature', sig)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});

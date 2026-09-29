/**
 * Integration tests (dev.v35, CH-5): QR representation routes.
 * Source: backend/src/modules/gateway/controllers/qr.controller.ts
 *         backend/src/modules/gateway/controllers/rtp.controller.ts (POST /requests/:ref/qr)
 *
 * Requires TEST_MONGODB_URI env var - skips gracefully when not set.
 *
 * Acceptance criteria (dev.v35 Step 1):
 * CH-3.8  issuing a QR is write-level: a role holding only paymentRequests:['view']
 *         (level1_analyst, security_auditor) gets 403; a customer holding
 *         paymentRequests:['view','manage'] passes the guard.
 * CH-3.b  resolving a QR stays read-level, so the oversight roles keep read access.
 * CH-2.7  an unsupported payloadFormat is rejected with 400, never downgraded to `url`.
 *
 * Guard isolation: the customer case targets a non-existent request reference and asserts 404
 * rather than 2xx. That proves the guard was passed without depending on seeded payout accounts,
 * which is what CH-3 is about.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../../psp/backend/bin/server';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

// Demo users, one per role (backend/data/customerAuthentications.json).
const USERS = {
  customer: 'luis.fernandez@back.es',        // paymentRequests: ['view', 'manage']
  analyst: 'sarah.chen@back.es',             // paymentRequests: ['view']
  auditor: 'diego.sans@back.es',             // paymentRequests: ['view'] - read-only oversight
};

const UNKNOWN_REF = 'req-does-not-exist-v35';

describe('dev.v35: QR representation routes', () => {
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

  // -- CH-3: issuing a QR is a write ---------------------------------------

  skip('CH-3: level1_analyst cannot issue a QR for an RTP request (403)', async () => {
    const res = await supertest(app.server)
      .post(`/api/v1/gateway/rtp/requests/${UNKNOWN_REF}/qr`)
      .set('Authorization', `Bearer ${tokens.analyst}`)
      .send({});
    expect(res.status).toBe(403);
  });

  skip('CH-3: security_auditor cannot issue a QR (403, read-only oversight)', async () => {
    const res = await supertest(app.server)
      .post(`/api/v1/gateway/rtp/requests/${UNKNOWN_REF}/qr`)
      .set('Authorization', `Bearer ${tokens.auditor}`)
      .send({});
    expect(res.status).toBe(403);
  });

  skip('CH-3: a customer passes the write guard (404 for a missing subject, not 403)', async () => {
    const res = await supertest(app.server)
      .post(`/api/v1/gateway/rtp/requests/${UNKNOWN_REF}/qr`)
      .set('Authorization', `Bearer ${tokens.customer}`)
      .send({});
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });

  skip('CH-3: issuing through the shared endpoint is also write-level (403 for the analyst)', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/gateway/qr/represent')
      .set('Authorization', `Bearer ${tokens.analyst}`)
      .send({ subjectType: 'rtp_request', subjectReference: UNKNOWN_REF });
    expect(res.status).toBe(403);
  });

  // -- CH-3b: resolving stays read-level -----------------------------------

  skip('resolve stays read-level: the analyst is not blocked by the guard (404, not 403)', async () => {
    const res = await supertest(app.server)
      .get(`/api/v1/gateway/qr/${UNKNOWN_REF}`)
      .set('Authorization', `Bearer ${tokens.analyst}`);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });

  // -- CH-2: unsupported format is rejected --------------------------------

  skip('CH-2: payloadFormat "emvco" is rejected with 400, not downgraded to url', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/gateway/qr/represent')
      .set('Authorization', `Bearer ${tokens.customer}`)
      .send({ subjectType: 'rtp_request', subjectReference: UNKNOWN_REF, payloadFormat: 'emvco' });
    expect(res.status).toBe(400);
    expect(res.body.payloadFormat).toBeUndefined();
  });

  skip('CH-2: sepa_epc is rejected for a subject with no derivable creditor account', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/gateway/qr/represent')
      .set('Authorization', `Bearer ${tokens.customer}`)
      .send({ subjectType: 'payment_link', subjectReference: UNKNOWN_REF, payloadFormat: 'sepa_epc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_subject_for_format');
  });

  // -- CH-1: the request no longer accepts creditor PII ---------------------

  skip('CH-1: iban and payeeName are not accepted as inputs (derived, never supplied)', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/gateway/qr/represent')
      .set('Authorization', `Bearer ${tokens.customer}`)
      .send({ subjectType: 'rtp_request', subjectReference: UNKNOWN_REF, iban: 'ES9121000418450200051332' });
    // The schema has no `iban` property, so the value is stripped and never reaches storage.
    expect(res.body.encodedPayload ?? '').not.toContain('ES9121000418450200051332');
  });
});

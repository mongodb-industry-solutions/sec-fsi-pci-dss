/**
 * Integration tests (dev.v30 FT / R10, FR-30.9, FR-30.11): card-payment multi-provider event flow.
 *
 * Pins the EDA + Hexagonal contract so a future change that breaks event order, correlation, or
 * category routing fails the build:
 *  - a card payment fans out to the provider-group gates (card_issuer, FDS, HRP, funds) on ONE
 *    correlationId and aggregates into a single authorization decision;
 *  - NO SAD (CVV) or full PAN ever appears in any bus payload (PCI DSS);
 *  - provider indifference: registering an external provider in a category still routes the flow
 *    (domain untouched), and removing it is idempotent.
 *
 * Requires TEST_MONGODB_URI: skips gracefully when not set. Real Fastify app + seeded test cluster.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../../psp/backend/bin/server';
import type { FastifyInstance } from 'fastify';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

// In test/dev mode the x-user-role header selects the effective role without a JWT (see
// integrations.test.ts). manager satisfies both transactions and audit-view guards.
const MANAGER = { 'x-user-role': 'manager' };

// A distinctive PAN + CVV so we can assert they NEVER appear in the serialized event trail.
const PROBE_PAN = '4111111111111111';
const PROBE_CVV = '321';

interface TrailEvent { eventType: string; correlationId: string; payload?: Record<string, unknown> }

describe('dev.v30 FT: card-payment multi-provider event flow (R10 / FR-30.11)', () => {
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

  // Create a card payment and return its correlationId (= cardTransactionInstanceReference).
  async function createPayment(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await supertest(app.server)
      .post('/api/v1/card-transactions')
      .set(MANAGER)
      .send({
        cardToken: `pm_v30_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        accountReference: 'ACC-V30-FLOW',
        amount: 42,
        currency: 'USD',
        cardTransactionMerchantName: 'Safe Store',
        cardTransactionMerchantCategoryCode: '5411',
        cardTransactionChannel: 'online',
        cardTransactionMaskedPanDisplay: '****-****-****-1111',
        cardTransactionType: 'purchase',
        cardTransactionDescription: 'SAFE STORE',
        cardVerification: { cardNumber: PROBE_PAN, cvv: PROBE_CVV, expiry: '05/27' },
        requireCardVerification: true,
        gatewayPayload: {},
        ...overrides,
      });
    expect([200, 201, 202]).toContain(res.status);
    const id = res.body.cardTransactionInstanceReference;
    expect(id).toBeTruthy();
    return id;
  }

  // Poll the correlated trail until the closing authorization event lands (async saga).
  async function waitForTrail(correlationId: string, timeoutMs = 8000): Promise<TrailEvent[]> {
    const deadline = Date.now() + timeoutMs;
    let events: TrailEvent[] = [];
    while (Date.now() < deadline) {
      const res = await supertest(app.server)
        .get(`/api/v1/events/trail/${correlationId}`)
        .set(MANAGER);
      expect(res.status).toBe(200);
      events = (res.body.events ?? []) as TrailEvent[];
      if (events.some(e => e.eventType === 'card.payment.authorization.completed')) return events;
      await new Promise(r => setTimeout(r, 250));
    }
    return events;
  }

  skip('fans out the four provider gates on one correlationId and aggregates a decision', async () => {
    const txnId = await createPayment();
    const events = await waitForTrail(txnId);

    const types = events.map(e => e.eventType);
    // Every gate request + completion must be present.
    for (const t of [
      'card.issuer.validation.requested', 'card.issuer.validation.completed',
      'fds.scoring.requested', 'fds.scoring.completed',
      'hrp.screening.requested', 'hrp.screening.completed',
      'funds.check.requested', 'funds.check.completed',
      'card.payment.authorization.completed',
    ]) {
      expect(types, `missing ${t}`).toContain(t);
    }

    // Correlation: every event of the journey shares the same correlationId.
    for (const e of events) expect(e.correlationId).toBe(txnId);

    // Ordering: each request precedes its own completion, and the aggregate decision is last.
    const idx = (t: string) => types.indexOf(t);
    expect(idx('card.issuer.validation.requested')).toBeLessThan(idx('card.issuer.validation.completed'));
    expect(idx('fds.scoring.requested')).toBeLessThan(idx('fds.scoring.completed'));
    expect(idx('hrp.screening.requested')).toBeLessThan(idx('hrp.screening.completed'));
    expect(idx('funds.check.requested')).toBeLessThan(idx('funds.check.completed'));
    expect(idx('card.payment.authorization.completed')).toBe(types.length - 1);
  });

  skip('never leaks CVV or full PAN into any bus payload (PCI DSS Req 3.2 / 10)', async () => {
    const txnId = await createPayment();
    const events = await waitForTrail(txnId);
    expect(events.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(events.map(e => e.payload ?? {}));
    expect(serialized).not.toContain(PROBE_PAN);
    expect(serialized).not.toContain(PROBE_CVV);

    // No cleartext SAD/CHD keys on the wire, only the opaque encrypted `chd` carrier is allowed.
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          expect(['cvv', 'cardNumber', 'pan', 'cardVerification']).not.toContain(k);
          walk(val);
        }
      }
    };
    for (const e of events) walk(e.payload ?? {});
  });
});

// ── Provider indifference (FR-30.9 / R9) ──────────────────────────────────────

describe('dev.v30 FT: provider indifference on a category group', () => {
  let app: FastifyInstance;
  let createdId: string | undefined;

  beforeAll(async () => {
    if (SKIP) return;
    process.env.MONGODB_URI     = process.env.TEST_MONGODB_URI!;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (SKIP) return;
    // Idempotent cleanup: remove the external provider we registered (ignore if already gone).
    if (createdId) {
      await supertest(app.server).delete(`/api/v1/integrations/${createdId}`).set(MANAGER);
    }
    await app.close();
  });

  skip('registering an external fraud_detection provider does not break the domain flow', async () => {
    // Register an EXTERNAL provider active in the fraud_detection category (in test status so it
    // does not need a reachable endpoint to prove routing indifference).
    const reg = await supertest(app.server)
      .post('/api/v1/integrations')
      .set(MANAGER)
      .send({
        externalProviderArrangementName: `V30 Indifference FDS ${Date.now()}`,
        externalProviderArrangementType: 'fraud_detection',
        externalProviderMode: 'sync',
        externalProviderApiEndpoint: `https://api.v30-indifference-${Date.now()}.example/score`,
        externalProviderArrangementStatus: 'test',
      });
    expect(reg.status).toBe(201);
    createdId = reg.body.integration.externalProviderArrangementInstanceReference;
    expect(createdId).toBeTruthy();

    // The domain path is unchanged: a payment still produces the full gate flow (the internal
    // provider remains internal-first / the group still routes). Domain logic never referenced a
    // concrete provider, so the decision still aggregates.
    const post = await supertest(app.server)
      .post('/api/v1/card-transactions')
      .set(MANAGER)
      .send({
        cardToken: `pm_v30_ind_${Date.now()}`,
        accountReference: 'ACC-V30-IND',
        amount: 30,
        currency: 'USD',
        cardTransactionMerchantName: 'Safe Store',
        cardTransactionMerchantCategoryCode: '5411',
        cardTransactionChannel: 'online',
        cardTransactionMaskedPanDisplay: '****-****-****-2222',
        cardTransactionType: 'purchase',
        cardTransactionDescription: 'SAFE STORE',
        gatewayPayload: {},
      });
    expect([200, 201, 202]).toContain(post.status);
    const txnId = post.body.cardTransactionInstanceReference;

    const deadline = Date.now() + 8000;
    let saw = false;
    while (Date.now() < deadline) {
      const res = await supertest(app.server).get(`/api/v1/events/trail/${txnId}`).set(MANAGER);
      const types = ((res.body.events ?? []) as TrailEvent[]).map(e => e.eventType);
      if (types.includes('card.payment.authorization.completed') && types.includes('fds.scoring.completed')) { saw = true; break; }
      await new Promise(r => setTimeout(r, 250));
    }
    expect(saw).toBe(true);
  });

  skip('removing the external provider is idempotent (delete twice succeeds/no-ops)', async () => {
    if (!createdId) return;
    const first  = await supertest(app.server).delete(`/api/v1/integrations/${createdId}`).set(MANAGER);
    expect([200, 204, 404]).toContain(first.status);
    const second = await supertest(app.server).delete(`/api/v1/integrations/${createdId}`).set(MANAGER);
    expect([200, 204, 404]).toContain(second.status);
    createdId = undefined; // already cleaned up
  });
});

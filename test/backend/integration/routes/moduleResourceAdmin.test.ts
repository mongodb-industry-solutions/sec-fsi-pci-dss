/**
 * Integration tests: v29 global resource administration via built-in modules.
 * Source: providers/card-issuer + providers/account-information controllers,
 *         modules/provider/services/capabilityGate.service.ts
 *
 * Requires TEST_MONGODB_URI - skips gracefully when not set.
 *
 * Acceptance criteria (FR-v29):
 *  FR-29.1  operations_officer lists all cards (paginated, display-safe, no expiry); other roles 403.
 *  FR-29.2  card detail returns the QE:none expiry to operations_officer.
 *  FR-29.3  register a card for an agreement.
 *  FR-29.4  patch alias + status.
 *  FR-29.5  revoke (soft-delete).
 *  FR-29.6  operations_officer lists all accounts (QE-stripped + hints); other roles 403.
 *  FR-29.7  account CRUD (create/get/patch/close), IBAN never returned.
 *  FR-29.8  gate: an active external provider in the capability group → 409 managed_externally.
 *  Scope    the customer role is blocked from /api/v1/modules (PCI Req 7).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import { buildApp } from '../../../../backend/bin/server';
import { createIntegration, deleteIntegration, updateHealthStatus } from '../../../../backend/src/modules/provider/services/integrationRegistry.service';
import { getDefaultGroupForType, removeMemberFromGroup } from '../../../../backend/src/modules/provider/services/integrationRoutingGroup.service';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

const CARDS = '/api/v1/modules/card-issuer/cards';
const ACCOUNTS = '/api/v1/modules/account-information/accounts';

describe('FR-v29: global resource administration (built-in modules)', () => {
  let app: FastifyInstance;
  let db: Db;
  let opsToken: string;        // operations_officer
  let merchantToken: string;   // merchant_officer (no cards permission)
  let managerToken: string;    // manager (no cards/accounts permission)
  let customerToken: string;   // customer (blocked from /modules)

  async function login(email: string): Promise<string> {
    const res = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'demo-password', domain: 'local' });
    // Fail fast with an actionable message if auth breaks (missing seed user, wrong password),
    // rather than surfacing as a downstream 401/403 in each test.
    expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.token, `no token returned for ${email}`).toBeTruthy();
    return res.body.token;
  }

  beforeAll(async () => {
    if (SKIP) return;
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI!;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
    app = await buildApp();
    await app.ready();
    db = (app as unknown as { db: Db }).db;
    opsToken = await login('olivia.moreno@back.es');
    merchantToken = await login('rachel.torres@back.es');
    managerToken = await login('alex.rivera@back.es');
    // A customer demo user (blocked from /modules by prefix).
    customerToken = await login('luis.fernandez@back.es');
  });

  afterAll(async () => {
    if (SKIP) return;
    await app.close();
  });

  // ── FR-29.1 cards list ────────────────────────────────────────────────────
  skip('FR-29.1: operations_officer lists all cards (display-safe, no expiry)', async () => {
    const res = await supertest(app.server).get(CARDS).set('Authorization', `Bearer ${opsToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.page).toBeGreaterThanOrEqual(1);
    expect(res.body.limit).toBeGreaterThanOrEqual(1);
    for (const row of res.body.results) {
      expect(row.paymentCardExpirationDate).toBeUndefined(); // list never exposes expiry
      expect(row.cvv).toBeUndefined();
    }
  });

  skip('FR-29.1: merchant_officer (no cards permission) → 403', async () => {
    const res = await supertest(app.server).get(CARDS).set('Authorization', `Bearer ${merchantToken}`);
    expect(res.status).toBe(403);
  });

  skip('Scope: customer role is blocked from /api/v1/modules', async () => {
    const res = await supertest(app.server).get(CARDS).set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  // ── FR-29.3/29.2/29.4/29.5 card lifecycle ─────────────────────────────────
  skip('FR-29.3/2/4/5: register → detail(expiry) → patch → status → revoke', async () => {
    const token = `tok_v29_${Date.now()}`;
    // FR-29.3 register
    const created = await supertest(app.server).post(CARDS).set('Authorization', `Bearer ${opsToken}`).send({
      customerAgreementInstanceReference: 'v29-test-agreement',
      cardToken: token,
      paymentCardMaskedPanDisplay: '****-****-****-4242',
      paymentCardExpirationDate: '12/29',
      paymentCardNetwork: 'VISA',
      paymentCardAlias: 'v29 test',
    });
    expect(created.status).toBe(201);
    const cardId = created.body.paymentCardInstanceReference;
    expect(cardId).toBeTruthy();

    // FR-29.3 CVV rejected by schema (additionalProperties:false)
    const withCvv = await supertest(app.server).post(CARDS).set('Authorization', `Bearer ${opsToken}`).send({
      customerAgreementInstanceReference: 'v29-test-agreement', cardToken: 'x', paymentCardMaskedPanDisplay: '****-****-****-0000', cvv: '123',
    });
    expect(withCvv.status).toBe(400);

    // FR-29.2 detail includes expiry
    const detail = await supertest(app.server).get(`${CARDS}/${cardId}`).set('Authorization', `Bearer ${opsToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.paymentCardExpirationDate).toBe('12/29');

    // FR-29.4 patch alias
    const patched = await supertest(app.server).patch(`${CARDS}/${cardId}`).set('Authorization', `Bearer ${opsToken}`).send({ paymentCardAlias: 'renamed' });
    expect(patched.status).toBe(200);

    // FR-29.4 status suspend
    const status = await supertest(app.server).patch(`${CARDS}/${cardId}/status`).set('Authorization', `Bearer ${opsToken}`).send({ active: false });
    expect(status.status).toBe(200);
    expect(status.body.paymentCardStatus).toBe('suspended');

    // FR-29.5 revoke
    const del = await supertest(app.server).delete(`${CARDS}/${cardId}`).set('Authorization', `Bearer ${opsToken}`);
    expect(del.status).toBe(200);
    expect(del.body.removed).toBe(true);
  });

  // ── FR-29.6 accounts list ─────────────────────────────────────────────────
  skip('FR-29.6: operations_officer lists all accounts (QE-stripped + hints)', async () => {
    const res = await supertest(app.server).get(ACCOUNTS).set('Authorization', `Bearer ${opsToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    for (const row of res.body.results) {
      expect(row.payoutAccountIban).toBeUndefined();
      expect(typeof row.payoutAccountHasIban).toBe('boolean');
    }
  });

  skip('FR-29.6: manager (no accounts permission) → 403', async () => {
    const res = await supertest(app.server).get(ACCOUNTS).set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(403);
  });

  // ── FR-29.7 account lifecycle ─────────────────────────────────────────────
  skip('FR-29.7: create → detail → patch → close (IBAN never returned)', async () => {
    const created = await supertest(app.server).post(ACCOUNTS).set('Authorization', `Bearer ${opsToken}`).send({
      partyInstanceReference: 'v29-test-party',
      payoutAccountType: 'bank_account',
      payoutAccountCurrency: 'EUR',
      payoutAccountCountryCode: 'ES',
      payoutAccountPreferredRail: 'sepa',
      payoutAccountIban: 'ES9121000418450200051332',
      payoutAccountAlias: 'v29 acct',
    });
    expect(created.status).toBe(201);
    const ref = created.body.payoutAccountInstanceReference;
    expect(ref).toBeTruthy();
    expect(created.body.payoutAccountIban).toBeUndefined();
    expect(created.body.payoutAccountHasIban).toBe(true);

    const detail = await supertest(app.server).get(`${ACCOUNTS}/${ref}`).set('Authorization', `Bearer ${opsToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.payoutAccountIban).toBeUndefined();

    const patched = await supertest(app.server).patch(`${ACCOUNTS}/${ref}`).set('Authorization', `Bearer ${opsToken}`).send({ payoutAccountAlias: 'renamed acct' });
    expect(patched.status).toBe(200);

    const closed = await supertest(app.server).delete(`${ACCOUNTS}/${ref}`).set('Authorization', `Bearer ${opsToken}`);
    expect(closed.status).toBe(200);
    expect(closed.body.closed).toBe(true);
  });

  // ── v29.1 module config guard (requirePermission('modules')) ──────────────
  skip('module /config: operations_officer (modules:view) → 200', async () => {
    const res = await supertest(app.server).get('/api/v1/modules/fds/config').set('Authorization', `Bearer ${opsToken}`);
    expect(res.status).toBe(200);
  });

  skip('module /config: merchant_officer (no modules permission) → 403', async () => {
    const res = await supertest(app.server).get('/api/v1/modules/fds/config').set('Authorization', `Bearer ${merchantToken}`);
    expect(res.status).toBe(403);
  });

  // ── v29.3 audit stream access (auditEvents:view) ──────────────────────────
  skip('audit stream: operations_officer can read /events/audit → 200', async () => {
    const res = await supertest(app.server).get('/api/v1/events/audit?limit=5').set('Authorization', `Bearer ${opsToken}`);
    expect(res.status).toBe(200);
  });

  // ── FR-29.8 capability gate ───────────────────────────────────────────────
  skip('FR-29.8: active external card-issuer provider → 409 managed_externally', async () => {
    const group = await getDefaultGroupForType(db, 'card_issuer');
    expect(group).toBeTruthy();
    // Register an active external provider in the default card-issuer group (priority < 999).
    const { integration } = await createIntegration(db, {
      name: 'v29 test external issuer',
      type: 'card_issuer',
      triggerEvents: ['card.issuer.validation.requested'],
      mode: 'async',
      initialStatus: 'active',
    });
    const extId = integration.externalProviderArrangementInstanceReference;
    await updateHealthStatus(db, extId, 'ok');

    try {
      const gated = await supertest(app.server).get(CARDS).set('Authorization', `Bearer ${opsToken}`);
      expect(gated.status).toBe(409);
      expect(gated.body.error).toBe('managed_externally');
    } finally {
      // Restore internal-only routing so the DB stays clean/idempotent for other tests.
      await removeMemberFromGroup(db, group!.routingGroupInstanceReference, extId);
      await deleteIntegration(db, extId);
    }

    // After cleanup the capability is internal again → 200.
    const restored = await supertest(app.server).get(CARDS).set('Authorization', `Bearer ${opsToken}`);
    expect(restored.status).toBe(200);
  });
});

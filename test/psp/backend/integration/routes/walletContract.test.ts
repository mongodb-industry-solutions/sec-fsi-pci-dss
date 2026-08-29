// v37 P0.1 contract baseline for Leafy Wallet: no endpoint, no parsed field and no domain-free
// request may break. Contract source: the plan's Invariants plus leafy-wallet's PspClient.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import {


  LIVE_READ, WALLET_CLIENT_ID, WALLET_REQUIRED_SCOPES,
  buildContractApp, closeContractApp, requireLive, mintOAuthToken, readSeedFile, routeExists, requiredBlocks,
  responseSchema, schemaKeepsField,
} from '../support/contract';

/**
 * The seeded principals, read from the identity authority's fixtures.
 *
 * This used to read a login file in this application. That file is gone with everything else about
 * identity, and the binding now runs the other way: a principal carries the business reference it
 * belongs to, rather than a login carrying a party.
 */
function readAuthorityIdentities(): Array<{ subjectId: string; accountHolderRef?: string; demoFeatured?: boolean }> {
  const raw = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../../../giam/backend/data/identities.json'),
    'utf8',
  );
  return JSON.parse(raw);
}

// A seeded customer with payout accounts, beneficiaries and executions. Deterministic ids.
const CUSTOMER_PARTY_REF = 'b0000001-0000-4000-8000-000000000001';

interface AuthSeed {
  customerAuthenticationInstanceReference: string;
  partyInstanceReference: string;
  customerAuthenticationUserRole: string;
}
interface MerchantSeed {
  merchantAgreementInstanceReference: string;
  merchantOAuthClient?: { oauthClientId: string; oauthScopes: string[]; oauthClientStatus: string };
}

function walletSub(): string {
  const auths = readAuthorityIdentities();
  const rec = auths.find((a) => a.accountHolderRef === CUSTOMER_PARTY_REF);
  if (!rec) throw new Error(`seed defect: no login record for ${CUSTOMER_PARTY_REF}`);
  return rec.subjectId;
}

// Every request the wallet makes: [method, concrete url, declared OpenAPI path]. The concrete url
// carries a placeholder ref, so a handler answering 404 for an unknown id is disambiguated from a
// route that no longer exists by also checking the declared path.
const WALLET_SURFACE: Array<[string, string, string]> = [
  ['GET', '/api/v1/accounts', '/api/v1/accounts'],
  ['GET', '/api/v1/beneficiaries', '/api/v1/beneficiaries'],
  ['POST', '/api/v1/beneficiaries', '/api/v1/beneficiaries'],
  ['POST', '/api/v1/beneficiaries/ctp-placeholder/transfer', '/api/v1/beneficiaries/{beneficiaryRef}/transfer'],
  ['GET', '/api/v1/transactions', '/api/v1/transactions'],
  ['POST', '/api/v1/gateway/rtp/requests', '/api/v1/gateway/rtp/requests'],
  ['GET', '/api/v1/gateway/rtp/requests', '/api/v1/gateway/rtp/requests'],
  ['GET', '/api/v1/gateway/rtp/requests?box=inbox', '/api/v1/gateway/rtp/requests'],
  ['GET', '/api/v1/gateway/rtp/requests?box=outbox', '/api/v1/gateway/rtp/requests'],
  ['GET', '/api/v1/gateway/rtp/requests/rtp-placeholder', '/api/v1/gateway/rtp/requests/{ref}'],
  ['POST', '/api/v1/gateway/rtp/requests/rtp-placeholder/present', '/api/v1/gateway/rtp/requests/{ref}/present'],
  ['POST', '/api/v1/gateway/rtp/requests/rtp-placeholder/accept', '/api/v1/gateway/rtp/requests/{ref}/accept'],
  ['POST', '/api/v1/gateway/rtp/requests/rtp-placeholder/reject', '/api/v1/gateway/rtp/requests/{ref}/reject'],
  ['POST', '/api/v1/gateway/rtp/requests/rtp-placeholder/cancel', '/api/v1/gateway/rtp/requests/{ref}/cancel'],
  ['POST', '/api/v1/auth/token', '/api/v1/auth/token'],
  ['POST', '/api/v1/auth/revoke', '/api/v1/auth/revoke'],
  ['POST', '/api/v1/auth/logout', '/api/v1/auth/logout'],
  ['GET', '/api/v1/auth/userinfo', '/api/v1/auth/userinfo'],
  ['GET', '/api/v1/auth/jwks', '/api/v1/auth/jwks'],
  ['GET', '/api/v1/auth/authorize', '/api/v1/auth/authorize'],
  ['POST', '/api/v1/auth/bc-authorize', '/api/v1/auth/bc-authorize'],
  ['GET', '/api/v1/auth/bc-authorize/bc-placeholder', '/api/v1/auth/bc-authorize/{authReqId}'],
  ['POST', '/api/v1/auth/bc-authorize/bc-placeholder/approve', '/api/v1/auth/bc-authorize/{authReqId}/approve'],
  ['POST', '/api/v1/auth/enroll/challenge', '/api/v1/auth/enroll/challenge'],
  ['POST', '/api/v1/auth/enroll', '/api/v1/auth/enroll'],
];

describe('v37 P0.1: Leafy Wallet contract baseline', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildContractApp(); });
  afterAll(async () => { await closeContractApp(app); });

  // ── Surface tier: no endpoint removed, renamed or stripped of a method ──────────────────────
  it.each(WALLET_SURFACE)('%s %s still resolves', async (method, url, declared) => {
    expect(await routeExists(app, method, url, declared)).toBe(true);
  });

  // ── Field paths: a strict response schema is how a field vanishes with no endpoint change ───
  it('the accounts response schema cannot strip payoutAccountBalance', () => {
    const schema = responseSchema(app, 'GET', '/api/v1/accounts');
    expect(schemaKeepsField(schema, 'payoutAccountBalance')).toBe(true);
  });

  it('collection responses keep the { results } envelope', () => {
    for (const path of ['/api/v1/accounts', '/api/v1/beneficiaries', '/api/v1/transactions']) {
      const schema = responseSchema(app, 'GET', path);
      expect(schemaKeepsField(schema, 'results')).toBe(true);
    }
  });

  // ── The wallet sends no auth domain: making one mandatory breaks it ─────────────────────────
  it('no wallet-facing route requires a domain parameter', () => {
    for (const [, , declared] of WALLET_SURFACE) {
      for (const block of requiredBlocks(app, declared)) expect(block).not.toContain('"domain"');
    }
  });

  it('the wallet OAuth client keeps every scope it depends on', () => {
    const merchants = readSeedFile<MerchantSeed[]>('merchants.json');
    const client = merchants
      .map((m) => m.merchantOAuthClient)
      .find((c) => c?.oauthClientId === WALLET_CLIENT_ID);
    expect(client, 'the wallet OAuth client must stay seeded').toBeTruthy();
    expect(client!.oauthClientStatus).toBe('active');
    for (const scope of WALLET_REQUIRED_SCOPES) expect(client!.oauthScopes).toContain(scope);
  });

  // ── Live read tier: the exact field paths the wallet parses, read-only ──────────────────────
  const live = LIVE_READ ? it : it.skip;

  live('GET /accounts returns { results } with payoutAccountBalance.availableAmount', async (ctx) => {
    if (!(await requireLive(app, ctx))) return;
    const token = await mintOAuthToken(walletSub(), ['read:accounts'], WALLET_CLIENT_ID);
    const res = await supertest(app.server).get('/api/v1/accounts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);
    for (const account of res.body.results) {
      expect(typeof account.payoutAccountInstanceReference).toBe('string');
      expect(typeof account.payoutAccountCurrency).toBe('string');
      expect(account.payoutAccountBalance).toBeTruthy();
      expect(typeof account.payoutAccountBalance.availableAmount).toBe('number');
      expect(typeof account.payoutAccountBalance.currency).toBe('string');
      // Display metadata the wallet renders. Masked IBAN is absent on an internal ledger account.
      expect(['string', 'undefined']).toContain(typeof account.payoutAccountAlias);
      expect(['string', 'undefined']).toContain(typeof account.payoutAccountBankName);
      expect(['boolean', 'undefined']).toContain(typeof account.payoutAccountIsDefault);
    }
    // PCI DSS / GDPR: the wallet channel never receives QE plaintext.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/"payoutAccountIban"/);
    expect(raw).not.toMatch(/"payoutAccountRoutingNumber"/);
  });

  live('GET /beneficiaries returns the counterparty fields the wallet maps', async (ctx) => {
    if (!(await requireLive(app, ctx))) return;
    const token = await mintOAuthToken(walletSub(), ['read:beneficiaries'], WALLET_CLIENT_ID);
    const res = await supertest(app.server).get('/api/v1/beneficiaries').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    for (const b of res.body.results) {
      expect(typeof b.counterpartyArrangementReference).toBe('string');
      expect(typeof b.counterpartyArrangementStatus).toBe('string');
      expect(['string', 'undefined']).toContain(typeof b.counterpartyLabel);
      expect(['string', 'undefined']).toContain(typeof b.counterpartyLookupType);
      expect(['string', 'undefined']).toContain(typeof b.counterpartyLookupHint);
    }
  });

  live('GET /transactions returns the { results } envelope', async (ctx) => {
    if (!(await requireLive(app, ctx))) return;
    const token = await mintOAuthToken(walletSub(), ['read:transactions'], WALLET_CLIENT_ID);
    const res = await supertest(app.server).get('/api/v1/transactions').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  live('GET /gateway/rtp/requests answers both boxes', async (ctx) => {
    if (!(await requireLive(app, ctx))) return;
    const token = await mintOAuthToken(walletSub(), ['read:rtp'], WALLET_CLIENT_ID);
    for (const box of ['inbox', 'outbox']) {
      const res = await supertest(app.server)
        .get(`/api/v1/gateway/rtp/requests?box=${box}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.results)).toBe(true);
    }
  });

  live('a request without a domain parameter is still authorised', async (ctx) => {
    if (!(await requireLive(app, ctx))) return;
    // The wallet sends no domain, realm or tenant. Any endpoint that starts requiring one breaks it.
    const token = await mintOAuthToken(walletSub(), ['read:accounts'], WALLET_CLIENT_ID);
    const res = await supertest(app.server).get('/api/v1/accounts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

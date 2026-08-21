/**
 * Integration tests: v23, merchant OAuth on-behalf-of channel on the SHARED capability modules.
 * The merchant is just another API client: it hits the same endpoints as first-party callers
 * (/beneficiaries, /accounts, /transactions, /gateway/transfers). The only difference is the auth
 * channel (RS256 Bearer + scope + subject binding), resolved by vendors/middleware/dualAuth.ts.
 *
 * Sources: beneficiary.controller.ts, payoutAccount.controller.ts, cardTransaction.controller.ts,
 *          transfer.controller.ts, vendors/middleware/{auth,dualAuth,validateMerchantToken}.ts
 *
 * Requires TEST_MONGODB_URI env var: skips gracefully when not set.
 *
 * Covers:
 *  (a) an RS256 OAuth token is accepted on the module endpoints (dualAuth flag, not the old HS256 401);
 *  (b) scope enforcement (403 insufficient_scope), subject binding (403 on a mismatched owner in the
 *      path), masked IBAN only (no raw payoutAccountIban), display-safe history (no CHD), 401 w/o token.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../../../../../psp/backend/bin/server';
import type { FastifyInstance } from 'fastify';
import { getOAuthKeyProvider } from '../../../../../psp/backend/src/modules/identity/services/oidcKeys.service';

const SKIP = !process.env.TEST_MONGODB_URI;
const skip = SKIP ? it.skip : it;

const ESPRESSO_CLIENT_ID = 'oauth001-0000-4000-8000-000000000001';
const SUB = 'PTY-MERCHANT-GW-TEST';
const OTHER_SUB = 'PTY-SOMEONE-ELSE';

// Mint a valid RS256 access token exactly like issueTokens() does (aud=clientId, space-delimited scope).
async function mintToken(sub: string, scopes: string[]): Promise<string> {
  const provider = getOAuthKeyProvider();
  const kid = provider.getKid();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: process.env.PSP_BASE_URL ?? 'http://localhost:8081',
    sub,
    aud: ESPRESSO_CLIENT_ID,
    exp: now + 3600,
    iat: now,
    jti: `test-${now}-${Math.random().toString(36).slice(2)}`,
    scope: scopes.join(' '),
    token_type: 'Bearer',
  };
  const headerAndPayload = [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
  ].join('.');
  const sig = await provider.sign(Buffer.from(headerAndPayload));
  return `${headerAndPayload}.${sig.toString('base64url')}`;
}

describe('v23 merchant OAuth channel on the shared modules', () => {
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

  // (a) Auth-boundary: the RS256 OAuth token is accepted on the module endpoint (owner from token).
  skip('beneficiaries: OAuth token is accepted (owner derived from token.sub)', async () => {
    const token = await mintToken(SUB, ['read:beneficiaries']);
    const res = await supertest(app.server)
      .get('/api/v1/beneficiaries')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  // (b) Accounts: masked IBAN only, scope + subject binding + 401.
  skip('accounts: 200 + masked IBAN only (no raw payoutAccountIban)', async () => {
    const token = await mintToken(SUB, ['read:accounts']);
    const res = await supertest(app.server)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/"payoutAccountIban"/);
    expect(raw).not.toMatch(/"payoutAccountRoutingNumber"/);
  });

  skip('accounts: subject binding, path owner != token.sub → 403', async () => {
    const token = await mintToken(SUB, ['read:accounts']);
    const res = await supertest(app.server)
      .get(`/api/v1/accounts/${OTHER_SUB}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  skip('accounts: missing scope → 403 insufficient_scope', async () => {
    const token = await mintToken(SUB, ['read:beneficiaries']);
    const res = await supertest(app.server)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
  });

  skip('accounts: no token → 401', async () => {
    const res = await supertest(app.server).get('/api/v1/accounts');
    expect(res.status).toBe(401);
  });

  skip('transactions: 200 with paginated shape and no CHD', async () => {
    const token = await mintToken(SUB, ['read:transactions']);
    const res = await supertest(app.server)
      .get('/api/v1/transactions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    const raw = JSON.stringify(res.body).toLowerCase();
    expect(raw).not.toMatch(/"pan"|"cardnumber"|"destinationiban"/);
  });

  skip('transfers/preview: requires write:transfers (403 without it)', async () => {
    const token = await mintToken(SUB, ['read:accounts']);
    const res = await supertest(app.server)
      .post('/api/v1/gateway/transfers/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ destination: { countryCode: 'DE', currency: 'EUR', iban: 'DE89370400440532013000' }, amountCurrency: 'EUR' });
    expect(res.status).toBe(403);
  });

  skip('transfers/preview: 200 with write:transfers', async () => {
    const token = await mintToken(SUB, ['write:transfers']);
    const res = await supertest(app.server)
      .post('/api/v1/gateway/transfers/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ destination: { countryCode: 'DE', currency: 'EUR', iban: 'DE89370400440532013000' }, amountCurrency: 'EUR' });
    expect(res.status).toBe(200);
    expect(typeof res.body.ok).toBe('boolean');
  });

  // Send-to-beneficiary (P2P): now POST /beneficiaries/:beneficiaryRef/transfer (owner from token).
  skip('beneficiaries/transfer: requires write:transfers (403 without it)', async () => {
    const token = await mintToken(SUB, ['read:beneficiaries']);
    const res = await supertest(app.server)
      .post('/api/v1/beneficiaries/btoken-does-not-matter/transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
  });

  // Subject binding on the two-segment (owner + ref) form: a path owner != token.sub → 403.
  skip('beneficiaries/transfer: path owner != token.sub → 403 access_denied', async () => {
    const token = await mintToken(SUB, ['write:transfers']);
    const res = await supertest(app.server)
      .post(`/api/v1/beneficiaries/${OTHER_SUB}/btoken-x/transfer`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('access_denied');
  });

  skip('beneficiaries/transfer: amount <= 0 → 422 invalid_amount', async () => {
    const token = await mintToken(SUB, ['write:transfers']);
    const res = await supertest(app.server)
      .post('/api/v1/beneficiaries/btoken-x/transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 0 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_amount');
  });

  skip('beneficiaries/transfer: no token → 401', async () => {
    const res = await supertest(app.server)
      .post('/api/v1/beneficiaries/btoken-x/transfer')
      .send({ amount: 10 });
    expect(res.status).toBe(401);
  });
});

// v37 P0.3 `sub` stability: Leafy Wallet keys its own Atlas data by the id_token `sub`, so a
// changed derivation or a regenerated seed id orphans that data silently.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import {
  LIVE_READ, WALLET_CLIENT_ID, buildContractApp, closeContractApp, requireLive, mintOAuthToken, readSeedFile,
} from '../support/contract';

interface AuthSeed {
  customerAuthenticationInstanceReference: string;
  partyInstanceReference: string;
  customerAuthenticationUserRole: string;
  customerAuthenticationAccountStatus: string;
}

function customerLogins(): AuthSeed[] {
  return readSeedFile<AuthSeed[]>('customerAuthentications.json')
    .filter((a) => a.customerAuthenticationUserRole === 'customer')
    .sort((a, b) => a.partyInstanceReference.localeCompare(b.partyInstanceReference));
}

describe('v37 P0.3: id_token sub stability', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildContractApp(); });
  afterAll(async () => { await closeContractApp(app); });

  it('every seeded customer keeps the same party to sub mapping', () => {
    const mapping = Object.fromEntries(
      customerLogins().map((a) => [a.partyInstanceReference, a.customerAuthenticationInstanceReference]),
    );
    expect(mapping).toMatchSnapshot();
  });

  it('sub is the login record id, not the party id', () => {
    for (const login of customerLogins()) {
      expect(login.customerAuthenticationInstanceReference)
        .not.toBe(login.partyInstanceReference);
    }
  });

  it('no two customers share a sub', () => {
    const subs = customerLogins().map((a) => a.customerAuthenticationInstanceReference);
    expect(new Set(subs).size).toBe(subs.length);
  });

  // ── Live: the database agrees with the seed, and the sub resolves to the same party ──────────
  const live = LIVE_READ ? it : it.skip;

  live('the database mapping matches the seed for every customer', async (ctx) => {
    if (!requireLive(app, ctx)) return;
    const { resolvePartyInstanceReference } = await import(
      '../../../../backend/src/modules/identity/services/oauth.service'
    );
    for (const login of customerLogins()) {
      const party = await resolvePartyInstanceReference(
        (app as unknown as { db: never }).db,
        login.customerAuthenticationInstanceReference,
      );
      expect(party).toBe(login.partyInstanceReference);
    }
  });

  live('userinfo answers the same sub the token carries', async (ctx) => {
    if (!requireLive(app, ctx)) return;
    const login = customerLogins()[0];
    const sub = login.customerAuthenticationInstanceReference;
    const token = await mintOAuthToken(sub, ['openid', 'profile'], WALLET_CLIENT_ID);
    const res = await supertest(app.server)
      .get('/api/v1/auth/userinfo')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sub).toBe(sub);
  });
});

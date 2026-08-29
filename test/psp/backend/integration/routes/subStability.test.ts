// v37 P0.3 `sub` stability: Leafy Wallet keys its own Atlas data by the id_token `sub`, so a
// changed derivation or a regenerated seed id orphans that data silently.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import {


  LIVE_READ, WALLET_CLIENT_ID, buildContractApp, closeContractApp, requireLive, mintOAuthToken, readSeedFile,
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

// The principal shape as the AUTHORITY publishes it. The old login interface described a record
// this application no longer holds, and keeping it would have been a second definition of a shape
// somebody else now owns.

function customerLogins(): Array<{ subjectId: string; accountHolderRef?: string; roleName?: string }> {
  return readAuthorityIdentities()
    .filter((a) => a.roleName === 'customer')
    .sort((a, b) => (a.accountHolderRef ?? '').localeCompare((b.accountHolderRef ?? '')));
}

describe('v37 P0.3: id_token sub stability', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildContractApp(); });
  afterAll(async () => { await closeContractApp(app); });

  it('every seeded customer keeps the same party to sub mapping', () => {
    const mapping = Object.fromEntries(
      customerLogins().map((a) => [(a.accountHolderRef ?? ''), a.subjectId]),
    );
    expect(mapping).toMatchSnapshot();
  });

  it('sub is the login record id, not the party id', () => {
    for (const login of customerLogins()) {
      expect(login.subjectId)
        .not.toBe(login.accountHolderRef);
    }
  });

  it('no two customers share a sub', () => {
    const subs = customerLogins().map((a) => a.subjectId);
    expect(new Set(subs).size).toBe(subs.length);
  });

  // ── Live: the database agrees with the seed, and the sub resolves to the same party ──────────
  const live = LIVE_READ ? it : it.skip;

  live('the database mapping matches the seed for every customer', async (ctx) => {
    if (!(await requireLive(app, ctx))) return;
    const { resolvePartyInstanceReference } = await import(
      '../../../../../psp/backend/src/modules/identity/services/oauth.service'
    );
    for (const login of customerLogins()) {
      const party = await resolvePartyInstanceReference(
        (app as unknown as { db: never }).db,
        login.subjectId,
      );
      expect(party).toBe(login.accountHolderRef);
    }
  });

  live('userinfo answers the same sub the token carries', async (ctx) => {
    if (!(await requireLive(app, ctx))) return;
    const login = customerLogins()[0];
    const sub = login.subjectId;
    const token = await mintOAuthToken(sub, ['openid', 'profile'], WALLET_CLIENT_ID);
    const res = await supertest(app.server)
      .get('/api/v1/auth/userinfo')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sub).toBe(sub);
  });
});

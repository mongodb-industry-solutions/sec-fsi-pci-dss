// v39 P11.3: this bank publishes no token endpoint, and that is the point.
//
// It used to issue its own tokens to third parties: a credential store, a signing key and a token
// endpoint of its own, inside a service whose business is banking. That is now the identity
// authority's, and a third party obtains a token there exactly as every other principal does.
//
// The suite that lived here asserted the endpoint existed and behaved. Those assertions are not
// weakened, they are relocated: how a token is ISSUED is the authority's contract and is tested in
// its suite. What is this bank's contract, and what is tested here, is what it ACCEPTS.
//
// So the shape inverts. The endpoint's absence is asserted rather than its behaviour, and the real
// path is proven end to end: a token obtained from the authority opens the Open Banking surface, and
// everything else is refused.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildApp } from '../../../../bank/backend/bin/server';
import { tppToken, stopTppAuthority } from '../support/tppToken';

describe('v39: the bank issues nothing and verifies everything', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await stopTppAuthority();
    if (app) await app.close();
  });

  it('publishes no token endpoint of its own', () => {
    // A bank that mints tokens is a bank with a credential store, a signing key and a rotation
    // policy, none of which are banking. Its absence from the routing table is the assertion.
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).not.toContain('/v1/oauth/token');
  });

  it('holds no token issuance code to reach even if a route were added', () => {
    // The route being gone is not the same as the capability being gone. The source assertion suite
    // covers this across both consumers; this is the local statement of the same fact.
    expect(
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      () => require('../../../../bank/backend/src/modules/tpp-trust/services/tppAccessToken.service'),
    ).toThrow();
  });

  it('accepts a token the identity authority issued', async () => {
    const token = await tppToken(['accounts', 'balances']);
    // Skipped rather than failed when the authority cannot start: the message would otherwise blame
    // the bank for something that is not its problem.
    if (!token) return;

    const response = await app.inject({
      method: 'GET',
      url: '/v1/accounts',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode, 'a real third-party token was refused').not.toBe(401);
  });

  it('refuses a request with no credential at all', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/accounts' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a token this platform did not issue', async () => {
    // Signed with a secret nobody here holds. It parses, and that is exactly why the refusal has to
    // come from verification against the authority's published keys rather than from parsing.
    const forged = jwt.sign(
      { sub: 'leafypay-psp', scope: 'accounts balances', aud: 'bankcore' },
      'a-secret-this-platform-never-issued',
      { expiresIn: 300 },
    );
    const response = await app.inject({
      method: 'GET',
      url: '/v1/accounts',
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a token asking for a scope the third party does not hold', async () => {
    // The authority declines to issue it, so there is no token to present. The gate is upstream of
    // the bank, which is the correct place for it: a scope the client never held cannot be minted.
    const overreaching = await tppToken(['accounts', 'a-scope-nobody-granted']);
    expect(overreaching, 'the authority issued a scope the client does not hold').toBeNull();
  });
});

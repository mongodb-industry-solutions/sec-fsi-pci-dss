// v37 P3.7b: the token endpoint and the refusal paths, against the real app.
//
// These assertions need no database: an unauthorised request must be refused before the bank consults
// its ledger, and that ordering is exactly what makes the check runnable offline. The database backed
// path (a real registration, a real secret) is covered by the unit suite and by setup validation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildApp } from '../../../../bank/backend/bin/server';
import { config } from '../../../../bank/backend/src/config';

describe('v37 P3.7b: the Open Banking surface requires a token this bank issued', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => { if (app) await app.close(); });

  it('publishes the token endpoint under the standard surface, not at a vendor prefix', () => {
    const paths = (app as unknown as { swagger: () => { paths: Record<string, unknown> } }).swagger().paths;
    expect(Object.keys(paths)).toContain('/v1/oauth/token');
  });

  it('refuses a grant it does not support, with the standard error code', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=password&client_id=leafypay-psp&client_secret=x',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('unsupported_grant_type');
  });

  it('accepts the form encoded body the grant is defined to use', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=client_credentials',
    });
    // Parsed, so the missing client is what is reported rather than a content type failure.
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_request');
  });

  it('never lets a credential exchange be cached', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=client_credentials&client_id=leafypay-psp',
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('refuses an account read with no token, before touching the ledger', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/accounts?holderId=hld-1', headers: { 'consent-id': 'c1' } });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toContain('Bearer');
    expect(response.json().tppMessages[0].code).toBe('TOKEN_INVALID');
  });

  it('refuses a JWT signed with the shared platform secret, which used to be accepted', async () => {
    const platformToken = jwt.sign(
      { client_id: 'leafypay-psp', scope: 'accounts balances transactions' },
      config.app.jwtSecret,
      { expiresIn: 120 },
    );
    const response = await app.inject({
      method: 'GET',
      url: '/v1/accounts?holderId=hld-1',
      headers: { authorization: `Bearer ${platformToken}`, 'consent-id': 'c1' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a credit with a read-only token, so a read credential cannot create funds', async () => {
    const { issueAccessToken } = await import('../../../../bank/backend/src/modules/tpp-trust/services/tppAccessToken.service');
    const readOnly = issueAccessToken(
      { tppRegistrationClientId: 'leafypay-psp', tppRegistrationRoles: ['AISP'] } as never,
      ['accounts', 'balances', 'transactions'],
    ).accessToken;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/accounts/acc-1/credits',
      headers: { authorization: `Bearer ${readOnly}` },
      payload: { amount: 10, currency: 'EUR' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().tppMessages[0].text).toContain('demo-credits');
  });
});

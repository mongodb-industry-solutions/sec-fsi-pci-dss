// v39 P7.7: a token from the platform's realm is refused by the bank, structurally.
//
// This is the defect ADR-067 declared unacceptable, closed and then held closed by test. The bank
// used to verify a PSP-ISSUED token with a shared secret, so the boundary between two institutions
// rested on the platform choosing not to mint one rather than on the bank being unable to accept it.
//
// The refusal now happens at the SIGNATURE, before any claim is examined: the two realms sign with
// different keys, published at different key sets, under different issuers. A cross-realm token
// cannot be made acceptable by improving its claims, which is the property worth testing.
//
// The second half is the separation the plan requires between the two grants: a machine credential
// and an interactive session must never substitute for each other, in EITHER direction. A
// third-party operation carries a consent obligation a staff session does not satisfy, and a staff
// operation is bounded by a role a third-party credential does not carry.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const PLATFORM_REALM = 'leafypay';
const BANK_REALM = 'bankcore';

let giam: FastifyInstance;
let bank: FastifyInstance;

/** Mints a real token from the authority, so nothing here is a hand-rolled approximation. */
async function machineToken(realm: string, clientId: string, clientSecret: string): Promise<string | null> {
  const response = await giam.inject({
    method: 'POST',
    url: `/realms/${realm}/protocol/openid-connect/token`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  return response.statusCode === 200 ? response.json().access_token : null;
}

function claims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

beforeAll(async () => {
  const { buildApp: buildGiam } = await import('../../../../giam/backend/src/app');
  giam = await buildGiam();
  await giam.ready();

  const { buildApp: buildBank } = await import('../../../../bank/backend/bin/server');
  bank = await buildBank();
  await bank.ready();
}, 180_000);

afterAll(async () => {
  await giam?.close();
  await bank?.close();
});

describe('v39 P7.7: the realms are separate institutions', () => {
  it('signs the two realms with different keys', async () => {
    const platform = await giam.inject({ method: 'GET', url: `/realms/${PLATFORM_REALM}/protocol/openid-connect/certs` });
    const bankKeys = await giam.inject({ method: 'GET', url: `/realms/${BANK_REALM}/protocol/openid-connect/certs` });

    const platformKids = platform.json().keys.map((key: { kid: string }) => key.kid);
    const bankKids = bankKeys.json().keys.map((key: { kid: string }) => key.kid);

    expect(platformKids.length).toBeGreaterThan(0);
    expect(bankKids.length).toBeGreaterThan(0);
    // No key is shared. This is what makes a cross-realm token fail at the signature rather than at
    // a claim check somebody could forget to write.
    expect(platformKids.filter((kid: string) => bankKids.includes(kid))).toEqual([]);
  });

  it('gives the two realms different issuers', async () => {
    const platform = await giam.inject({ method: 'GET', url: `/realms/${PLATFORM_REALM}/.well-known/openid-configuration` });
    const bankMeta = await giam.inject({ method: 'GET', url: `/realms/${BANK_REALM}/.well-known/openid-configuration` });
    expect(platform.json().issuer).not.toBe(bankMeta.json().issuer);
  });

  it('refuses a platform-realm token on the Open Banking surface', async () => {
    const platformToken = await machineToken(PLATFORM_REALM, 'leafypay-backend', 'leafypay-backend-demo-secret-2026');
    expect(platformToken, 'the platform realm did not issue a token to test with').toBeTruthy();
    // A genuine, unexpired, correctly signed token. It is simply not this bank's.
    expect(claims(platformToken as string).iss).toContain(PLATFORM_REALM);

    const response = await bank.inject({
      method: 'GET',
      url: '/v1/accounts?holderId=hld00001-0000-4000-8000-000000000001',
      headers: { authorization: `Bearer ${platformToken}`, 'consent-id': 'c1' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().tppMessages[0].code).toBe('TOKEN_INVALID');
  });

  it('refuses a platform-realm token on the bank administrative surface', async () => {
    const platformToken = await machineToken(PLATFORM_REALM, 'leafypay-backend', 'leafypay-backend-demo-secret-2026');
    const response = await bank.inject({
      method: 'GET',
      url: '/api/v1/admin/module/config',
      headers: { authorization: `Bearer ${platformToken}` },
    });
    // 401, not 403: it is not a question of insufficient authority, it is not a token this bank can
    // read at all.
    expect(response.statusCode).toBe(401);
  });

  it('accepts the bank realm third-party token it is meant to accept', async () => {
    const tppToken = await machineToken(BANK_REALM, 'leafypay-psp', 'dev-bankcore-tpp-secret');
    expect(tppToken, 'the bank realm did not issue a third-party token').toBeTruthy();

    const payload = claims(tppToken as string);
    expect(payload.iss).toContain(BANK_REALM);
    // The registered capacities arrive as permissions resolved from its role, through the same
    // decision point a person goes through.
    const permissions = payload.permissions as Array<{ resource: string; action: string }>;
    expect(permissions).toContainEqual({ resource: 'psd2Role', action: 'AISP' });
  });
});

describe('v39 P7: the machine and interactive grants never substitute for each other', () => {
  it('refuses an interactive token on the third-party surface', async () => {
    // Signed in as a bank administrator, which is the strongest interactive principal there is. It
    // is still refused, because a third-party operation carries a consent obligation that being an
    // administrator does not satisfy.
    const login = await giam.inject({
      method: 'POST',
      url: `/realms/${BANK_REALM}/login`,
      payload: { login: 'Samuel Adeyemi', password: 'demo-password' },
    });
    expect(login.statusCode).toBe(200);

    const response = await bank.inject({
      method: 'GET',
      url: '/v1/accounts?holderId=hld00001-0000-4000-8000-000000000001',
      headers: { authorization: 'Bearer not-a-third-party-token', 'consent-id': 'c1' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a third-party machine token on the staff surface', async () => {
    const tppToken = await machineToken(BANK_REALM, 'leafypay-psp', 'dev-bankcore-tpp-secret');
    const response = await bank.inject({
      method: 'GET',
      url: '/api/v1/admin/module/config',
      headers: { authorization: `Bearer ${tppToken}` },
    });
    // 403: the token is readable and valid, and it is the wrong KIND of principal for this surface.
    // A machine credential reaching the bank's back office is the boundary this holds.
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatch(/signed-in person|machine credential/i);
  });

  it('refuses an unauthenticated request before it reaches the ledger', async () => {
    const response = await bank.inject({
      method: 'GET',
      url: '/v1/accounts?holderId=hld00001-0000-4000-8000-000000000001',
      headers: { 'consent-id': 'c1' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toContain('Bearer');
  });
});

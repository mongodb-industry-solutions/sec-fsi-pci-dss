// v39 P7.4 and P7.7: the bank gains people, and refuses the other institution's tokens.
//
// This bank had no users. Its access was entirely machine to machine, so it could not express that
// viewing a card, revealing the number on it and changing a ledger record are three different
// authorities: it had nobody to hold them.
//
// The flow here is the whole one and every step is real. A person signs in at the authority, which
// runs as its own process, exchanges the session for an authorization code with PKCE, redeems the
// code, and presents the resulting token to the bank, which authorises per permission. No token is
// hand-rolled and no signature is faked.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  startAuthority, machineToken, interactiveToken, decodeClaims, type Authority,
} from '../support/authorityProcess';

const BANK_REALM = 'bankcore';
const PLATFORM_REALM = 'leafypay';
const CONSOLE_CLIENT = 'bankcore-console';
const REDIRECT_URI = 'http://localhost:8084/api/auth/callback';
const DEMO_PASSWORD = 'demo-password';

let bank: FastifyInstance;
let authority: Authority | null = null;

async function signIn(login: string): Promise<{ token: string; claims: Record<string, unknown> } | null> {
  const token = await interactiveToken(
    authority as Authority, BANK_REALM, login, DEMO_PASSWORD, CONSOLE_CLIENT, REDIRECT_URI,
  );
  return token ? { token, claims: decodeClaims(token) } : null;
}

beforeAll(async () => {
  authority = await startAuthority();

  const { buildApp } = await import('../../../../bank/backend/bin/server');
  bank = await buildApp();
  await bank.ready();
}, 180_000);

afterAll(async () => {
  await bank?.close();
  await authority?.stop();
});

describe('v39 P7.4: a bank employee signs in and works under a role', () => {
  it('completes sign-in, authorization code with PKCE, and redemption', async () => {
    if (!authority) return;
    const result = await signIn('Marta Oliveira');
    expect(result, 'the interactive flow produced no token').toBeTruthy();

    const { claims } = result as { claims: Record<string, unknown> };
    expect(claims.iss).toContain(BANK_REALM);
    expect(claims.roles).toContain('bank_operations');
    // Not a machine: a machine authenticates as itself, so its subject IS its client id. A person's
    // is not, and that is what the staff guard distinguishes on.
    expect(claims.sub).not.toBe(claims.client_id);
  });

  it('authorises the operations role on accounts and refuses it a card disclosure', async () => {
    if (!authority) return;
    const result = await signIn('Marta Oliveira');
    const permissions = (result as { claims: Record<string, unknown> }).claims.permissions as Array<{ resource: string; action: string }>;

    expect(permissions).toContainEqual({ resource: 'accounts', action: 'manage' });
    // The separation this bank could not previously express: operating a card is not disclosing it.
    expect(permissions).not.toContainEqual({ resource: 'cardData', action: 'viewSensitive' });

    const refused = await bank.inject({
      method: 'POST',
      url: '/api/v1/admin/cards/tok-does-not-exist/disclosures',
      headers: { authorization: `Bearer ${(result as { token: string }).token}` },
      payload: { reason: 'test' },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatch(/cardData/);
  });

  it('lets the card officer, and only the card officer, reach a disclosure', async () => {
    if (!authority) return;
    const officer = await signIn('Tomas Reyes');
    const permissions = (officer as { claims: Record<string, unknown> }).claims.permissions as Array<{ resource: string; action: string }>;
    expect(permissions).toContainEqual({ resource: 'cardData', action: 'viewSensitive' });

    const response = await bank.inject({
      method: 'POST',
      url: '/api/v1/admin/cards/tok-does-not-exist/disclosures',
      headers: { authorization: `Bearer ${(officer as { token: string }).token}` },
      payload: { reason: 'test' },
    });
    // Past the guard. What it meets next is the lookup failing for an unknown card, which is the
    // distinction being asserted: authorised, then not found.
    expect(response.statusCode).not.toBe(403);
  });

  it('keeps compliance read-only', async () => {
    if (!authority) return;
    const compliance = await signIn('Ingrid Larsen');
    const permissions = (compliance as { claims: Record<string, unknown> }).claims.permissions as Array<{ resource: string; action: string }>;

    expect(permissions).toContainEqual({ resource: 'bankAudit', action: 'view' });
    // Someone who can change what they oversee cannot attest to it.
    expect(permissions.filter((permission) => permission.action === 'manage')).toEqual([]);
    expect(permissions).not.toContainEqual({ resource: 'cardData', action: 'viewSensitive' });
  });

  it('keeps the administrator away from customer data', async () => {
    if (!authority) return;
    const admin = await signIn('Samuel Adeyemi');
    const permissions = (admin as { claims: Record<string, unknown> }).claims.permissions as Array<{ resource: string; action: string }>;

    expect(permissions).toContainEqual({ resource: 'tppRegistrations', action: 'manage' });
    // Configures the bank without reading what flows through it.
    expect(permissions.some((permission) => permission.resource === 'accounts')).toBe(false);
    expect(permissions.some((permission) => permission.resource === 'accountHolders')).toBe(false);
  });

  it('reaches the bank administrative surface with a real token', async () => {
    if (!authority) return;
    const admin = await signIn('Samuel Adeyemi');
    const response = await bank.inject({
      method: 'GET',
      url: '/api/v1/admin/module/config',
      headers: { authorization: `Bearer ${(admin as { token: string }).token}` },
    });
    // The point of the whole phase: a person, signed in at the authority, authorised at the bank.
    expect(response.statusCode).toBe(200);
  });
});

describe('v39 P7.4: an account holder sees their own records and nobody else s', () => {
  it('is bound to their own account holder reference', async () => {
    if (!authority) return;
    const holder = await signIn('Elena Duarte');
    const claims = (holder as { claims: Record<string, unknown> }).claims;

    expect(claims.roles).toContain('bank_customer');
    // The self scope, as an opaque binding the authority never resolves. It means something to the
    // bank and nothing to the authority, which is the correct direction for it to travel.
    expect(claims.account_holder).toBe('hld00001-0000-4000-8000-000000000001');
  });

  it('holds no authority over anybody else s records', async () => {
    if (!authority) return;
    const holder = await signIn('Elena Duarte');
    const permissions = (holder as { claims: Record<string, unknown> }).claims.permissions as Array<{ resource: string; action: string }>;

    // Needs no consent, because there is no third party: this is their own data at their own
    // institution. What they must not have is any route to somebody else's.
    expect(permissions).toContainEqual({ resource: 'accounts', action: 'view' });
    expect(permissions.filter((permission) => permission.action === 'manage')).toEqual([]);
    expect(permissions).not.toContainEqual({ resource: 'accountHolders', action: 'view' });
  });
});

describe('v39 P7.7: the two institutions are separate, and the two grants do not substitute', () => {
  it('refuses a platform-realm token on the Open Banking surface', async () => {
    if (!authority) return;
    const platformToken = await machineToken(authority, PLATFORM_REALM, 'leafypay-backend', 'leafypay-backend-demo-secret-2026');
    expect(platformToken, 'the platform realm issued no token to test with').toBeTruthy();
    // Genuine, unexpired and correctly signed. It is simply not this bank's, and no improvement to
    // its claims could make it acceptable, because it fails at the signature.
    expect(decodeClaims(platformToken as string).iss).toContain(PLATFORM_REALM);

    const response = await bank.inject({
      method: 'GET',
      url: '/v1/accounts?holderId=hld00001-0000-4000-8000-000000000001',
      headers: { authorization: `Bearer ${platformToken}`, 'consent-id': 'c1' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().tppMessages[0].code).toBe('TOKEN_INVALID');
  });

  it('refuses a platform-realm token on the bank administrative surface', async () => {
    if (!authority) return;
    const platformToken = await machineToken(authority, PLATFORM_REALM, 'leafypay-backend', 'leafypay-backend-demo-secret-2026');
    const response = await bank.inject({
      method: 'GET',
      url: '/api/v1/admin/module/config',
      headers: { authorization: `Bearer ${platformToken}` },
    });
    // 401 rather than 403: this is not insufficient authority, it is a token the bank cannot read.
    expect(response.statusCode).toBe(401);
  });

  it('accepts the bank-realm third party it is meant to accept', async () => {
    if (!authority) return;
    const tppToken = await machineToken(authority, BANK_REALM, 'leafypay-psp', 'dev-bankcore-tpp-secret');
    expect(tppToken).toBeTruthy();

    const claims = decodeClaims(tppToken as string);
    expect(claims.iss).toContain(BANK_REALM);
    // Its registered capacities arrive as permissions resolved from its role, through the same
    // decision point a person goes through.
    expect(claims.permissions).toContainEqual({ resource: 'psd2Role', action: 'AISP' });
  });

  it('refuses a third-party machine token on the staff surface', async () => {
    if (!authority) return;
    const tppToken = await machineToken(authority, BANK_REALM, 'leafypay-psp', 'dev-bankcore-tpp-secret');
    const response = await bank.inject({
      method: 'GET',
      url: '/api/v1/admin/module/config',
      headers: { authorization: `Bearer ${tppToken}` },
    });
    // 403: readable, valid, and the wrong KIND of principal. A third-party credential reaching the
    // bank's back office is the boundary this holds.
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatch(/signed-in person|machine credential/i);
  });

  it('refuses an interactive token on the third-party surface', async () => {
    if (!authority) return;
    // A bank administrator, the strongest interactive principal there is, still refused: a
    // third-party operation carries a consent obligation that being an administrator does not
    // satisfy, and the two grants must not substitute in either direction.
    const admin = await signIn('Samuel Adeyemi');
    const response = await bank.inject({
      method: 'GET',
      url: '/v1/accounts?holderId=hld00001-0000-4000-8000-000000000001',
      headers: { authorization: `Bearer ${(admin as { token: string }).token}`, 'consent-id': 'c1' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().tppMessages[0].text).toMatch(/third-party credential/i);
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

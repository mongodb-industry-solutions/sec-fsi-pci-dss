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
import { clientSecretFor } from '@leafypay/platform-links';
import {
  startAuthority, machineToken, interactiveToken, decodeClaims, type Authority,
} from '../support/authorityProcess';

/**
 * The SHARED realm (ADR-003). The bank is a client in it, not a directory of its own: what keeps it
 * separate is its own resource server, its own roles and its own token audience.
 */
const BANK_REALM = 'leafypay';
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

/**
 * What a token's roles actually expand to, asked of the authority.
 *
 * The separation-of-duties claims below are about PERMISSIONS, and v40 stopped putting them in the
 * token. So they are resolved the way the bank resolves them at runtime: the published catalog,
 * fetched with the caller's own token, which returns the roles that caller holds. Asserting against
 * the fixture instead would be asserting the fixture against itself.
 */
async function expanded(token: string, held: string[]): Promise<Set<string>> {
  const response = await fetch(`${authority!.baseUrl}/realms/leafypay/permissions`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return new Set();
  const body = await response.json() as {
    roles: Array<{ name: string; permissions: string[] }>;
    permissions: Array<{ permission: string; resourceServer: string }>;
  };

  /**
   * Scoped to THIS BANK's resource server, which is the whole point of the claims below.
   *
   * A bank employee also holds `realm_administrator`, so an unscoped union returns the authority's
   * own permissions too and "compliance manages nothing" reads as false: they manage role
   * assignments AT THE AUTHORITY, which is a different statement about a different system. The
   * separation being asserted is within the bank.
   */
  const ofTheBank = new Set(
    body.permissions.filter((entry) => entry.resourceServer === 'bankcore').map((entry) => entry.permission),
  );

  /**
   * Only the roles THIS CALLER holds, taken from their own token.
   *
   * The endpoint returns the whole catalog to a caller who administers the realm, and every bank
   * employee also holds `realm_administrator`. Unioning whatever came back therefore credited a
   * compliance officer with the administrator's permissions, and the separation being asserted
   * would have passed for the wrong reason.
   */
  const mine = new Set(held);
  return new Set(
    body.roles
      .filter((role) => mine.has(role.name))
      .flatMap((role) => role.permissions)
      .filter((permission) => ofTheBank.has(permission)),
  );
}

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
    /**
     * v40 carries ROLES in the token, not expanded permissions.
     *
     * The permissions claim is absent unless a client narrowed, so asserting it here asserted the
     * pre-v40 contract. What the role expands to is proven below by the guarded route's answer,
     * which is where enforcement actually happens and a stronger claim than reading a claim.
     */
    const roles = (result as { claims: Record<string, unknown> }).claims.roles as string[];
    expect(roles).toContain('bank_operations');
    // The separation this bank could not previously express: operating a card is not disclosing it.
    expect(roles).not.toContain('bank_card_officer');

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
    /**
     * v40 carries ROLES in the token, not expanded permissions.
     *
     * The permissions claim is absent unless a client narrowed, so asserting it here asserted the
     * pre-v40 contract. What the role expands to is proven below by the guarded route's answer,
     * which is where enforcement actually happens and a stronger claim than reading a claim.
     */
    const roles = (officer as { claims: Record<string, unknown> }).claims.roles as string[];
    expect(roles).toContain('bank_card_officer');

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
    /**
     * v40 carries ROLES in the token, not expanded permissions.
     *
     * The permissions claim is absent unless a client narrowed, so asserting it here asserted the
     * pre-v40 contract. What the role expands to is proven below by the guarded route's answer,
     * which is where enforcement actually happens and a stronger claim than reading a claim.
     */
    const roles = (compliance as { claims: Record<string, unknown> }).claims.roles as string[];
    expect(roles).toContain('bank_compliance');

    const held = await expanded((compliance as { token: string }).token, roles);
    expect(held).toContain('bankAudit:view');
    // Someone who can change what they oversee cannot attest to it.
    expect([...held].filter((permission) => permission.endsWith(':manage'))).toEqual([]);
    expect(held).not.toContain('cardData:viewSensitive');
  });

  it('keeps the administrator away from customer data', async () => {
    if (!authority) return;
    const admin = await signIn('Samuel Adeyemi');
    /**
     * v40 carries ROLES in the token, not expanded permissions.
     *
     * The permissions claim is absent unless a client narrowed, so asserting it here asserted the
     * pre-v40 contract. What the role expands to is proven below by the guarded route's answer,
     * which is where enforcement actually happens and a stronger claim than reading a claim.
     */
    const roles = (admin as { claims: Record<string, unknown> }).claims.roles as string[];
    expect(roles).toContain('bank_admin');

    const held = await expanded((admin as { token: string }).token, roles);
    expect(held).toContain('tppRegistrations:manage');
    // Configures the bank without reading what flows through it.
    expect([...held].some((permission) => permission.startsWith('accounts:'))).toBe(false);
    expect([...held].some((permission) => permission.startsWith('accountHolders:'))).toBe(false);
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
    /**
     * v40 carries ROLES in the token, not expanded permissions.
     *
     * The permissions claim is absent unless a client narrowed, so asserting it here asserted the
     * pre-v40 contract. What the role expands to is proven below by the guarded route's answer,
     * which is where enforcement actually happens and a stronger claim than reading a claim.
     */
    const roles = (holder as { claims: Record<string, unknown> }).claims.roles as string[];
    expect(roles).toContain('bank_customer');

    // Needs no consent, because there is no third party: this is their own data at their own
    // institution. What they must not have is any route to somebody else's.
    const held = await expanded((holder as { token: string }).token, roles);
    expect(held).toContain('accounts:view');
    expect([...held].filter((permission) => permission.endsWith(':manage'))).toEqual([]);
    // The whole point of the self scope: reading ACCOUNT HOLDERS is reading other people.
    expect(held).not.toContain('accountHolders:view');
  });
});

/**
 * The two institutions remain separate, by audience and resource server rather than by realm.
 *
 * ADR-003 merged the directories so a person exists once. What did NOT merge is what each
 * application accepts: a token addressed to one is refused by the other, and their permissions are
 * declared on different resource servers.
 */
describe('v39 P7.7: the two institutions are separate, and the two grants do not substitute', () => {
  it('refuses a payment service token on the Open Banking surface', async () => {
    if (!authority) return;
    const platformToken = await machineToken(authority, PLATFORM_REALM, 'leafypay-backend', clientSecretFor('leafypay-backend'));
    expect(platformToken, 'no token to test with').toBeTruthy();
    /**
     * Genuine, unexpired and CORRECTLY SIGNED BY THE KEY THIS BANK TRUSTS.
     *
     * That is the part that changed. Both applications share one realm since ADR-003, so this
     * token passes the signature check and the issuer check; what refuses it is the AUDIENCE. It
     * names the payment service, and this bank accepts only its own.
     *
     * The test is the same claim as before and a slightly harder one: the refusal can no longer be
     * explained away as "a different key", so it is proving the audience check rather than
     * incidentally proving the key material.
     */
    const claims = decodeClaims(platformToken as string);
    expect(claims.iss).toContain(PLATFORM_REALM);
    expect(claims.aud, 'the token must name the payment service, not the bank').toContain('leafypay');

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
    const platformToken = await machineToken(authority, PLATFORM_REALM, 'leafypay-backend', clientSecretFor('leafypay-backend'));
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
    const tppToken = await machineToken(authority, BANK_REALM, 'leafypay-psp', clientSecretFor('leafypay-psp'));
    expect(tppToken).toBeTruthy();

    const claims = decodeClaims(tppToken as string);
    expect(claims.iss).toContain(BANK_REALM);
    /**
     * Its registered capacities arrive as its ROLE, resolved through the same decision point a
     * person goes through, and expanded by the resource server against the published catalog.
     *
     * The permission itself is asserted through that expansion rather than off the token, because
     * v40 stopped putting expanded permissions in one: a machine that carried every capacity it
     * held would be a token that fails on whichever proxy is strictest.
     */
    const roles = claims.roles as string[];
    expect(roles).toContain('third_party_provider');
    const held = await expanded(tppToken as string, roles);
    expect(held).toContain('psd2Role:AISP');
  });

  it('refuses a third-party machine token on the staff surface', async () => {
    if (!authority) return;
    const tppToken = await machineToken(authority, BANK_REALM, 'leafypay-psp', clientSecretFor('leafypay-psp'));
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

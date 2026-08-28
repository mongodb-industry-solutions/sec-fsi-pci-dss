// v37 P3.7b: the bank issues its own access tokens to registered TPPs, and nothing else opens its API.
//
// The property under test is the hole this closes: until now the bank accepted any JWT signed with the
// shared platform secret, so anything on the platform could read accounts. A token has to come from
// this bank, for an active registration, carrying the scope and the role the endpoint requires.
import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Db } from 'mongodb';
import bcrypt from 'bcryptjs';
import { authenticateTpp, hashClientSecret } from '../../../../bank/backend/src/modules/tpp-trust/services/tppRegistration.service';
import { issueAccessToken, verifyAccessToken } from '../../../../bank/backend/src/modules/tpp-trust/services/tppAccessToken.service';
import { requireTpp } from '../../../../bank/backend/src/vendors/middleware/tppAuth';
import { config } from '../../../../bank/backend/src/config';
import type { TppRegistrationControlRecord } from '../../../../bank/backend/src/modules/tpp-trust/models/tppRegistration.model';

const SECRET = 'dev-bankcore-tpp-secret';

function registration(overrides: Partial<TppRegistrationControlRecord> = {}): TppRegistrationControlRecord {
  return {
    tppRegistrationInstanceReference: 'tpp-leafypay-001',
    tppRegistrationName: 'Leafy Pay',
    tppRegistrationClientId: 'leafypay-psp',
    tppRegistrationClientSecretHash: bcrypt.hashSync(SECRET, 4),
    tppRegistrationGrantedScopes: ['accounts', 'balances', 'transactions', 'demo-credits'],
    tppRegistrationRoles: ['AISP', 'PISP'],
    tppRegistrationStatus: 'active',
    tppRegistrationApiVersion: '1.3.6',
    tppRegistrationEnvironment: 'sandbox',
    bianServiceDomain: 'Party Authentication',
    bianControlRecordType: 'TppRegistration',
    recordCreatedDateTime: '2026-08-18T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  } as TppRegistrationControlRecord;
}

// Minimal stand-in for the registry lookup, which is all authenticateTpp uses.
function fakeDb(records: TppRegistrationControlRecord[]): Db {
  return {
    collection: () => ({
      async findOne(filter: { tppRegistrationClientId: string }) {
        return records.find((r) => r.tppRegistrationClientId === filter.tppRegistrationClientId) ?? null;
      },
    }),
  } as unknown as Db;
}

// The reply and request the middleware sees, recorded rather than mocked away.
function fakeReply() {
  const state: { status?: number; body?: { tppMessages?: Array<{ code: string; text: string }> }; headers: Record<string, string> } = { headers: {} };
  const reply = {
    header(name: string, value: string) { state.headers[name] = value; return reply; },
    status(code: number) { state.status = code; return reply; },
    send(body: unknown) { state.body = body as never; return reply; },
  };
  return { reply, state };
}

function fakeRequest(authorization?: string, dbError: string | null = null) {
  return {
    headers: authorization ? { authorization } : {},
    server: { dbError },
  } as never;
}

describe('v37 P3.7b: client credentials against a registered TPP', () => {
  it('authenticates a registered, active client with the right secret', async () => {
    const result = await authenticateTpp(fakeDb([registration()]), 'leafypay-psp', SECRET, []);
    expect(result.ok).toBe(true);
    // An omitted scope means every granted scope, per the grant's own rules.
    if (result.ok) expect(result.scopes).toEqual(['accounts', 'balances', 'transactions', 'demo-credits']);
  });

  it('refuses a wrong secret and an unknown client with the SAME error', async () => {
    const db = fakeDb([registration()]);
    const wrongSecret = await authenticateTpp(db, 'leafypay-psp', 'not-the-secret', []);
    const unknown = await authenticateTpp(db, 'someone-else', SECRET, []);
    // Distinguishing the two is how a caller enumerates the registered clients.
    expect(wrongSecret).toEqual(unknown);
    expect(wrongSecret.ok).toBe(false);
  });

  it('refuses a registration that is not active, so revocation is immediate', async () => {
    const db = fakeDb([registration({ tppRegistrationStatus: 'revoked' })]);
    const result = await authenticateTpp(db, 'leafypay-psp', SECRET, []);
    expect(result.ok).toBe(false);
  });

  it('narrows the token to the requested scopes and refuses one that was never granted', async () => {
    const db = fakeDb([registration()]);
    const narrowed = await authenticateTpp(db, 'leafypay-psp', SECRET, ['balances']);
    expect(narrowed.ok && narrowed.scopes).toEqual(['balances']);

    const ungranted = await authenticateTpp(db, 'leafypay-psp', SECRET, ['payments']);
    expect(ungranted.ok).toBe(false);
    if (!ungranted.ok) expect(ungranted.failure.error).toBe('invalid_scope');
  });

  it('hashes a secret in the bcrypt shape the bank compares', async () => {
    const hash = await hashClientSecret('rotated-secret');
    expect(hash.startsWith('$2')).toBe(true);
    expect(await bcrypt.compare('rotated-secret', hash)).toBe(true);
  });
});

describe('v37 P3.7b: only a token the bank issued opens the bank', () => {
  it('issues a token that verifies back to its client, scopes and roles', () => {
    const { accessToken, expiresIn, scope } = issueAccessToken(registration(), ['accounts', 'balances']);
    expect(expiresIn).toBeGreaterThan(0);
    expect(scope).toBe('accounts balances');
    const claims = verifyAccessToken(accessToken);
    expect(claims).toMatchObject({ clientId: 'leafypay-psp', scopes: ['accounts', 'balances'], roles: ['AISP', 'PISP'] });
  });

  it('REJECTS a JWT signed with the shared platform secret, which is the hole this closes', () => {
    const platformToken = jwt.sign(
      { client_id: 'leafypay-psp', scope: 'accounts balances transactions' },
      config.app.adminSecret,
      { expiresIn: 120 },
    );
    expect(verifyAccessToken(platformToken)).toBeNull();
    // And the two keys are genuinely different, so the rejection is not an accident of configuration.
    expect(config.bank.accessTokenSecret).not.toBe(config.app.adminSecret);
  });

  it('rejects a token issued for another audience or by another issuer', () => {
    const foreign = jwt.sign({ client_id: 'leafypay-psp', scope: 'accounts' }, config.bank.accessTokenSecret, {
      issuer: 'some-other-bank', audience: 'bankcore-open-banking', expiresIn: 120,
    });
    expect(verifyAccessToken(foreign)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ client_id: 'leafypay-psp', scope: 'accounts' }, config.bank.accessTokenSecret, {
      issuer: 'bankcore', audience: 'bankcore-open-banking', expiresIn: -1,
    });
    expect(verifyAccessToken(expired)).toBeNull();
  });
});

describe('v37 P3.7b: scope and role are enforced per endpoint', () => {
  let token: string;
  beforeEach(() => {
    token = issueAccessToken(registration({ tppRegistrationRoles: ['AISP'] }), ['accounts']).accessToken;
  });

  it('answers 401 with a challenge when no token is presented', async () => {
    const { reply, state } = fakeReply();
    await requireTpp('accounts', 'AISP')(fakeRequest(), reply as never);
    expect(state.status).toBe(401);
    expect(state.headers['WWW-Authenticate']).toContain('Bearer');
    expect(state.body!.tppMessages![0].code).toBe('TOKEN_INVALID');
  });

  it('answers 403 when the token lacks the endpoint scope, distinct from having no token', async () => {
    const { reply, state } = fakeReply();
    await requireTpp('balances', 'AISP')(fakeRequest(`Bearer ${token}`), reply as never);
    expect(state.status).toBe(403);
    expect(state.body!.tppMessages![0].text).toContain('balances');
  });

  it('answers 403 when the TPP does not hold the role the endpoint acts under', async () => {
    const { reply, state } = fakeReply();
    await requireTpp('accounts', 'PISP')(fakeRequest(`Bearer ${token}`), reply as never);
    expect(state.status).toBe(403);
    expect(state.body!.tppMessages![0].code).toBe('ROLE_INVALID');
  });

  it('lets a correctly scoped token through and exposes its context', async () => {
    const { reply, state } = fakeReply();
    const request = fakeRequest(`Bearer ${token}`) as unknown as { tpp?: { clientId: string } };
    await requireTpp('accounts', 'AISP')(request as never, reply as never);
    expect(state.status).toBeUndefined();
    expect(request.tpp).toMatchObject({ clientId: 'leafypay-psp' });
  });

  it('reports an unreachable ledger as unavailable, and only after authorising', async () => {
    const { reply, state } = fakeReply();
    await requireTpp('accounts', 'AISP')(fakeRequest(`Bearer ${token}`, 'connect ECONNREFUSED'), reply as never);
    expect(state.status).toBe(503);
    // An unauthenticated caller still gets 401: it never reaches the database at all.
    const anonymous = fakeReply();
    await requireTpp('accounts', 'AISP')(fakeRequest(undefined, 'connect ECONNREFUSED'), anonymous.reply as never);
    expect(anonymous.state.status).toBe(401);
  });
});

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
import { requireTpp } from '../../../../bank/backend/src/vendors/middleware/tppAuth';
import { config } from '../../../../bank/backend/src/config';
import type { TppRegistrationControlRecord } from '../../../../bank/backend/src/modules/tpp-trust/models/tppRegistration.model';
import { clientSecretFor } from '@leafypay/platform-links';

const SECRET = clientSecretFor('leafypay-psp');

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

// v39: the two describes that followed tested a token endpoint this service no longer has.
//
// The bank issues nothing now: a third party gets its token from the identity authority and this
// service verifies it against the published key set, like every other token it sees. Verification
// and per-endpoint scope enforcement are covered by the authority suite and by the integration
// tests that drive a real token through a real request, which is a better test of the same property
// than one that minted its own token and then checked it could read it back.

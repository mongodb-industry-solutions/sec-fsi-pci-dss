// The `self` scope, enforced.
//
// The regression this exists to prevent is not subtle and it was live: `bank_customer` is declared
// `scopeKind: self` at the authority, the guard that binds a holder to their own records was
// exported and wired to NO route, and an account holder calling the list endpoints was served the
// whole bank's accounts and cards, byte for byte what an operations officer sees.
//
// So the assertions are about the BOUNDARY rather than about status codes: an account holder is
// admitted, and what comes back names nobody but them. A test that only checked for a 200 would
// have passed throughout the entire period the bank was leaking.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../bank/backend/bin/server';
import { staffToken, stopStaffAuthority } from '../support/staffToken';

const HOLDER = () => staffToken('accountHolder');
const OPERATIONS = () => staffToken('operations');

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

describe('an account holder reaches their own records and nobody else\'s', () => {
  let app: FastifyInstance;
  let holderToken: string | null;
  let ownReference: string | undefined;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    holderToken = await HOLDER();
    ownReference = holderToken
      ? claimsOf(holderToken).account_holder as string | undefined
      : undefined;
  });

  afterAll(async () => {
    await stopStaffAuthority();
    if (app) await app.close();
  });

  it('carries the binding in the token, which is what every assertion below rests on', () => {
    if (!holderToken) return;
    expect(ownReference, 'the seeded account holder must be bound to a record at this bank').toBeTruthy();
  });

  it('lists only the accounts of the holder who asked', async () => {
    if (!holderToken || !ownReference) return;
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/accounts?limit=150',
      headers: { authorization: `Bearer ${holderToken}` },
    });
    expect(response.statusCode).toBe(200);
    const { results } = response.json() as { results: Array<{ accountHolderInstanceReference: string }> };
    const strangers = results.filter((row) => row.accountHolderInstanceReference !== ownReference);
    expect(strangers, 'an account holder was served somebody else\'s accounts').toEqual([]);
  });

  it('lists only the cards of the holder who asked', async () => {
    if (!holderToken || !ownReference) return;
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/cards?limit=150',
      headers: { authorization: `Bearer ${holderToken}` },
    });
    expect(response.statusCode).toBe(200);
    const { results } = response.json() as { results: Array<{ holderReference: string | null }> };
    const strangers = results.filter((row) => row.holderReference && row.holderReference !== ownReference);
    expect(strangers, 'an account holder was served somebody else\'s cards').toEqual([]);
  });

  it('refuses a holder filter naming somebody else rather than quietly rewriting it', async () => {
    if (!holderToken) return;
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/accounts?holder=hld00002-0000-4000-8000-000000000002',
      headers: { authorization: `Bearer ${holderToken}` },
    });
    // Unless that IS them, in which case the request was legitimate and the seed changed underneath.
    if (ownReference === 'hld00002-0000-4000-8000-000000000002') return;
    expect(response.statusCode).toBe(403);
  });

  it('refuses one account belonging to another holder, and says so rather than hiding it', async () => {
    if (!holderToken || !ownReference) return;
    const operations = await OPERATIONS();
    if (!operations) return;

    // Found through a role that legitimately sees the whole bank, so the test does not assume the seed.
    const everything = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/accounts?limit=150',
      headers: { authorization: `Bearer ${operations}` },
    });
    const { results } = everything.json() as {
      results: Array<{ accountArrangementInstanceReference: string; accountHolderInstanceReference: string }>;
    };
    const stranger = results.find((row) => row.accountHolderInstanceReference !== ownReference);
    expect(stranger, 'the bank must hold an account belonging to somebody else for this to mean anything').toBeTruthy();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/accounts/${stranger!.accountArrangementInstanceReference}`,
      headers: { authorization: `Bearer ${holderToken}` },
    });
    // 403 and not 404: the record exists, and answering "no such account" would be answering a
    // question about somebody else's record.
    expect(response.statusCode).toBe(403);
  });

  it('still lets a bank-wide role see more than one holder, so the binding did not become a blanket filter', async () => {
    const operations = await OPERATIONS();
    if (!operations) return;
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/accounts?limit=150',
      headers: { authorization: `Bearer ${operations}` },
    });
    expect(response.statusCode).toBe(200);
    const { results } = response.json() as { results: Array<{ accountHolderInstanceReference: string }> };
    const holders = new Set(results.map((row) => row.accountHolderInstanceReference));
    expect(holders.size).toBeGreaterThan(1);
  });
});

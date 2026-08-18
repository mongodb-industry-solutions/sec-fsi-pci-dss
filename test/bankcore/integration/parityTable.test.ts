// v37 P3.11: the standardized parity table, as a gate rather than as review attention.
//
// The rule it protects is P4's: the PSP calls ONLY these endpoints. A row with no endpoint means the PSP
// would need a non-standard call to do something it does today, which is a blocker for P4 and not a
// detail, so the table is encoded here with the phase that delivers each row. A row whose phase has
// landed must exist in the published document; a row whose phase has not is reported, so what is left is
// visible instead of being rediscovered later.
//
// Keeping the phase on each row is what makes this honest while the plan is still in flight: it fails on a
// regression (a delivered endpoint disappearing) without pretending that unstarted work is done.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../bankcore/bin/server';

interface ParityRow {
  // What the PSP does today with its built-in engines.
  capability: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  // The phase that delivers it. 'done' means it must be present now.
  phase: 'done' | 'P3.6' | 'P3.9' | 'P7' | 'P8';
  // Whether the endpoint must declare the TPP security scheme. The token endpoint cannot: it is how a
  // caller obtains the token in the first place.
  secured?: boolean;
}

const PARITY: ParityRow[] = [
  { capability: 'obtain a TPP access token', method: 'post', path: '/v1/oauth/token', phase: 'done', secured: false },
  { capability: 'create an account access consent', method: 'post', path: '/v1/consents', phase: 'done' },
  { capability: 'read a consent', method: 'get', path: '/v1/consents/{consentId}', phase: 'done' },
  { capability: 'read consent status', method: 'get', path: '/v1/consents/{consentId}/status', phase: 'done' },
  { capability: 'revoke a consent', method: 'delete', path: '/v1/consents/{consentId}', phase: 'done' },
  { capability: "read a customer's accounts", method: 'get', path: '/v1/accounts', phase: 'done' },
  { capability: 'read account detail, IBAN and routing', method: 'get', path: '/v1/accounts/{accountId}', phase: 'done' },
  { capability: 'read balances including the available amount', method: 'get', path: '/v1/accounts/{accountId}/balances', phase: 'done' },
  { capability: 'read account movements', method: 'get', path: '/v1/accounts/{accountId}/transactions', phase: 'done' },
  { capability: 'credit an account (demo operation, bank side only)', method: 'post', path: '/v1/accounts/{accountId}/credits', phase: 'done' },
  { capability: 'funds gate before authorising a card or transfer', method: 'post', path: '/v1/funds-confirmations', phase: 'done' },
  { capability: 'initiate a credit transfer', method: 'post', path: '/v1/payments/{paymentProduct}', phase: 'done' },
  { capability: 'read a payment', method: 'get', path: '/v1/payments/{paymentProduct}/{paymentId}', phase: 'done' },
  { capability: 'query payment status', method: 'get', path: '/v1/payments/{paymentProduct}/{paymentId}/status', phase: 'done' },
  { capability: 'cancel a payment where applicable', method: 'delete', path: '/v1/payments/{paymentProduct}/{paymentId}', phase: 'done' },
  // Not yet delivered. Each names the phase that owns it, so this list is the remaining work rather than
  // a wish: the notification path needs a subscription to deliver to, the rest are their own phases.
  { capability: 'recurring mandate (periodic payments)', method: 'post', path: '/v1/periodic-payments/{paymentProduct}', phase: 'P3.9' },
  { capability: 'card issuance and lifecycle', method: 'post', path: '/v1/cards', phase: 'P7' },
  // Delivered ahead of the rest of the card move, because the PSP's funds gate cannot stay correct once
  // the ledger is here: its stored balance is a projection, so a local hold decides on stale data.
  { capability: 'card authorisation and decline', method: 'post', path: '/v1/cards/authorisations', phase: 'done' },
  { capability: 'release or settle an authorisation hold', method: 'delete', path: '/v1/cards/authorisations/{authorisationReference}', phase: 'done' },
  { capability: 'card token resolution and masking', method: 'get', path: '/v1/cards/{cardToken}', phase: 'P7' },
  { capability: 'credit assessment', method: 'post', path: '/v1/credit-assessments', phase: 'P8' },
];

describe('v37 P3.11: parity with what the PSP does today', () => {
  let app: FastifyInstance;
  let paths: Record<string, Record<string, { security?: unknown[]; summary?: string }>>;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    paths = (app as unknown as { swagger: () => { paths: typeof paths } }).swagger().paths ?? {};
  });

  afterAll(async () => { if (app) await app.close(); });

  const delivered = PARITY.filter((row) => row.phase === 'done');

  it('has rows to check, so the assertions below are not vacuous', () => {
    expect(delivered.length).toBeGreaterThan(10);
  });

  for (const row of delivered) {
    it(`${row.capability} → ${row.method.toUpperCase()} ${row.path}`, () => {
      const operation = paths[row.path]?.[row.method];
      expect(operation, `${row.method.toUpperCase()} ${row.path} is missing: the PSP would need a non standard call`).toBeDefined();
      if (row.secured !== false) {
        // An endpoint without the security scheme is one a caller could reach unauthenticated, or at
        // least one whose documentation says so, which is the same problem for a TPP integrating.
        expect(operation!.security, `${row.path} must declare the TPP security scheme`).toBeDefined();
      }
    });
  }

  it('reports what the table still owes, with the phase that owns each row', () => {
    const outstanding = PARITY.filter((row) => row.phase !== 'done');
    const unexpectedlyPresent = outstanding.filter((row) => paths[row.path]?.[row.method]);
    // Finding one of these is good news, and it means this table is out of date rather than the code.
    expect(
      unexpectedlyPresent.map((row) => `${row.path} (${row.phase})`),
      'these are implemented but still marked as pending: move them to done',
    ).toEqual([]);
    // Printed rather than asserted: the remaining phases are the plan's, not this test's, to complete.
    expect(outstanding.map((row) => row.phase)).toEqual(
      expect.arrayContaining(['P3.9', 'P7', 'P8']),
    );
  });

  it('every served Open Banking route appears in the table, so nothing arrives unlisted', () => {
    const listed = new Set(PARITY.map((row) => `${row.method} ${row.path}`));
    const served: string[] = [];
    for (const [path, operations] of Object.entries(paths)) {
      if (!path.startsWith('/v1/')) continue;
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        if (operations[method]) served.push(`${method} ${path}`);
      }
    }
    const unlisted = served.filter((route) => !listed.has(route));
    // Administration lives at /api/v1/admin and is not in this table by design: the table is about what
    // the PSP calls in place of its built-in engines, not about configuring the bank.
    // An endpoint nobody put in the parity table is an endpoint whose purpose was never argued for. This
    // is the same discipline the Module to Collection matrix enforces for collections.
    expect(unlisted, 'add it to the parity table or remove it').toEqual([]);
  });
});

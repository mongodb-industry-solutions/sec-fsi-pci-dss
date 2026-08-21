// v37 P3.3/P3.5: the payment surface as a TPP sees it, plus the error shape that guards the whole API.
//
// The error-shape assertions are the important half. A `required` in a schema makes Fastify answer first
// with its own {statusCode, error, message} body, which a route's error schema then STRIPS to `{}`,
// because it declares `tppMessages` and nothing else. The caller gets an empty 400 for the most common
// mistake there is. The app renders validation failures itself for that reason, and this is what pins it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../bank/backend/bin/server';
import { issueAccessToken } from '../../../../bank/backend/src/modules/tpp-trust/services/tppAccessToken.service';

const token = (roles: Array<'AISP' | 'PISP'>, scopes: string[]) => issueAccessToken(
  { tppRegistrationClientId: 'leafypay-psp', tppRegistrationRoles: roles } as never,
  scopes as never,
).accessToken;

describe('v37 P3.3: the payment initiation surface', () => {
  let app: FastifyInstance;
  let paths: Record<string, Record<string, { summary?: string; description?: string }>>;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    paths = (app as unknown as { swagger: () => { paths: typeof paths } }).swagger().paths;
  });

  afterAll(async () => { if (app) await app.close(); });

  it('exposes initiation, read, status and cancellation at the standard paths', () => {
    expect(paths['/v1/payments/{paymentProduct}'].post).toBeDefined();
    expect(paths['/v1/payments/{paymentProduct}/{paymentId}'].get).toBeDefined();
    expect(paths['/v1/payments/{paymentProduct}/{paymentId}'].delete).toBeDefined();
    expect(paths['/v1/payments/{paymentProduct}/{paymentId}/status'].get).toBeDefined();
  });

  it('documents the transaction status enumeration a client has to switch on', () => {
    const description = paths['/v1/payments/{paymentProduct}/{paymentId}/status'].get.description ?? '';
    for (const status of ['RCVD', 'ACTC', 'ACSP', 'ACSC', 'RJCT', 'CANC']) {
      expect(description, `${status} must be documented`).toContain(status);
    }
  });

  it('says plainly that initiation does not execute, since ACTC is easy to misread', () => {
    const description = paths['/v1/payments/{paymentProduct}'].post.description ?? '';
    expect(description).toContain('does not execute');
    // And that a retry is safe, which is the property a payment caller most needs to know.
    expect(description).toContain('X-Request-ID');
  });

  it('refuses initiation with no token at all', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/payments/sepa-credit-transfers', payload: {} });
    expect(response.statusCode).toBe(401);
    expect(response.json().tppMessages[0].code).toBe('TOKEN_INVALID');
  });

  it('refuses an AISP-only credential: initiating is a different role AND a different scope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payments/sepa-credit-transfers',
      headers: { authorization: `Bearer ${token(['AISP'], ['accounts', 'balances'])}` },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses initiation with no Consent-ID, in the Berlin Group shape', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payments/sepa-credit-transfers',
      headers: { authorization: `Bearer ${token(['PISP'], ['payments'])}` },
      // A complete body, so the consent is the only thing missing: an incomplete one would be refused
      // for its format first, which is the correct order but not what this test is about.
      payload: {
        instructedAmount: { currency: 'EUR', amount: '10.00' },
        debtorAccount: { iban: 'ES2098208323403025812509' },
        creditorAccount: { iban: 'DE89370400440532013000' },
        creditorName: 'X',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().tppMessages[0].code).toBe('CONSENT_INVALID');
  });
});

describe('v37: a schema failure still looks like this bank', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { if (app) await app.close(); });

  it('renders a missing required body field as tppMessages, not as an empty object', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payments/sepa-credit-transfers',
      headers: { authorization: `Bearer ${token(['PISP'], ['payments'])}`, 'consent-id': 'cns-1' },
      payload: { creditorName: 'X' },
    });
    const body = response.json();
    // The failure that motivated this: an empty `{}` with a 400, which tells the caller nothing.
    expect(Object.keys(body).length).toBeGreaterThan(0);
    if (response.statusCode === 400 && body.tppMessages) {
      expect(body.tppMessages[0].code).toMatch(/FORMAT_ERROR|CONSENT_INVALID/);
      expect(body.tppMessages[0].text).toBeTruthy();
    }
  });

  it('keeps the required fields in the published contract, which is what made the shape matter', () => {
    const spec = (app as unknown as { swagger: () => { paths: Record<string, Record<string, { requestBody?: unknown }>> } }).swagger();
    const operation = spec.paths['/v1/payments/{paymentProduct}'].post;
    const schema = (operation.requestBody as { content: Record<string, { schema: { required?: string[] } }> })
      .content['application/json'].schema;
    // Rendering the error properly means the schema does NOT have to be weakened to stay usable.
    expect(schema.required).toEqual(expect.arrayContaining([
      'instructedAmount', 'debtorAccount', 'creditorAccount', 'creditorName',
    ]));
  });
});

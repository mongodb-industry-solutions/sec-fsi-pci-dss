// v37 P3.1/P3.10b: the consent endpoints as a TPP sees them, and the refusals that need no database.
//
// The database-backed lifecycle is covered by the unit suite and exercised live by setup validation.
// What is asserted here is the surface: that the endpoints exist at the standard's own paths, are
// documented, carry the security scheme, and that an AIS read without a consent is refused with the
// Berlin Group error body rather than with Fastify's generic one. That last point has bitten this
// project before: a `required` header schema makes the framework answer first, in the wrong shape.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../bank/backend/bin/server';
import { tppToken, stopTppAuthority } from '../support/tppToken';

const AISP_TOKEN = () => tppToken(['accounts', 'balances', 'transactions']);

describe('v37 P3.1: the consent surface', () => {
  let app: FastifyInstance;
  let paths: Record<string, Record<string, { summary?: string; tags?: string[] }>>;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    paths = (app as unknown as { swagger: () => { paths: typeof paths } }).swagger().paths;
  });

  afterAll(async () => {
    await stopTppAuthority(); if (app) await app.close(); });

  it('exposes the four consent operations at the standard paths', () => {
    expect(Object.keys(paths)).toEqual(expect.arrayContaining([
      '/v1/consents', '/v1/consents/{consentId}', '/v1/consents/{consentId}/status',
    ]));
    expect(paths['/v1/consents'].post).toBeDefined();
    expect(paths['/v1/consents/{consentId}'].get).toBeDefined();
    expect(paths['/v1/consents/{consentId}'].delete).toBeDefined();
    expect(paths['/v1/consents/{consentId}/status'].get).toBeDefined();
  });

  it('documents the status enumeration a client has to switch on', () => {
    const operation = paths['/v1/consents/{consentId}/status'].get as { description?: string };
    for (const status of ['received', 'valid', 'rejected', 'revokedByPsu', 'expired', 'terminatedByTpp']) {
      expect(operation.description, `${status} must be documented`).toContain(status);
    }
  });

  it('states that no SCA is performed, rather than leaving the omission implicit', () => {
    const operation = paths['/v1/consents'].post as { description?: string };
    expect(operation.description).toContain('SCA');
  });

  it('refuses a consent operation with no TPP token, before touching the ledger', async () => {
    for (const url of ['/v1/consents/cns-1', '/v1/consents/cns-1/status']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
      expect(response.json().tppMessages[0].code).toBe('TOKEN_INVALID');
    }
  });

  it('answers a missing Consent-ID in the Berlin Group shape, not the framework default', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/accounts/acc-1/balances',
      headers: { authorization: `Bearer ${await AISP_TOKEN()}` },
    });
    expect(response.statusCode).toBe(400);
    // A `required` header schema would have Fastify answer {statusCode, error, message} instead.
    const body = response.json();
    expect(body.tppMessages[0].code).toBe('CONSENT_INVALID');
    expect(body.error).toBeUndefined();
  });

  it('no longer accepts a holder parameter: the consent is what identifies the holder', () => {
    const operation = paths['/v1/accounts'].get as { parameters?: Array<{ name: string }> };
    const names = (operation.parameters ?? []).map((parameter) => parameter.name);
    expect(names).not.toContain('holderId');
  });
});

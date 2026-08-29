// v37 P3.7a/P3.10a: the bank's administration surface.
//
// Two things it must get right. It is admin-token protected, because engine configuration and TPP status
// are not things a TPP token should reach. And it is NOT at `/v1`: no Open Banking standard covers
// "configure the card simulator" or "suspend a TPP", so putting them on the surface a TPP integrates
// against would make that surface non-standard, which is the rule the coverage gate exists to keep.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildApp } from '../../../../bank/backend/bin/server';
import { staffToken, stopStaffAuthority } from '../support/staffToken';
import { tppToken, stopTppAuthority } from '../support/tppToken';

// A real employee token: the administrative surface takes a PERMISSION the authority resolved, not
// a role name asserted inside a token this test signed for itself.
const ADMIN = () => staffToken('administrator');
// An employee with a real token and no administrative permission. The refusal has to come from what
// the authority granted them, not from the absence of a credential.
const NOT_ADMIN = () => staffToken('operations');
const TPP = () => tppToken(['accounts', 'balances', 'transactions', 'payments']);

// Concrete URLs, for calling the app.
const ADMIN_ROUTES: Array<[string, string]> = [
  ['GET', '/api/v1/admin/module/config'],
  ['GET', '/api/v1/admin/module/config/card-issuer'],
  ['PUT', '/api/v1/admin/module/config/card-issuer'],
  ['GET', '/api/v1/admin/tpp/registrations'],
  ['PATCH', '/api/v1/admin/tpp/registrations/tpp-leafypay-001/status'],
  ['POST', '/api/v1/admin/tpp/registrations/tpp-leafypay-001/secret/rotate'],
  ['GET', '/api/v1/admin/consents'],
  ['PATCH', '/api/v1/admin/consents/cns-1/status'],
];

// The same routes as OpenAPI writes them, with the parameters templated. Kept separate from the concrete
// list because one is for calling the app and the other for reading its published contract.
const ADMIN_PATHS = [
  '/api/v1/admin/module/config',
  '/api/v1/admin/module/config/{capability}',
  '/api/v1/admin/tpp/registrations',
  '/api/v1/admin/tpp/registrations/{reference}/status',
  '/api/v1/admin/tpp/registrations/{reference}/secret/rotate',
  '/api/v1/admin/consents',
  '/api/v1/admin/consents/{consentId}/status',
];

describe('v37 P3.7a: the administration surface is separate and protected', () => {
  let app: FastifyInstance;
  let paths: Record<string, Record<string, { summary?: string; description?: string; security?: unknown[] }>>;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    paths = (app as unknown as { swagger: () => { paths: typeof paths } }).swagger().paths ?? {};
  });

  afterAll(async () => {
    await stopStaffAuthority();
    await stopTppAuthority(); if (app) await app.close(); });

  it('publishes every administration route under /api/v1/admin, never under /v1', () => {
    const adminPaths = Object.keys(paths).filter((path) => path.startsWith('/api/v1/admin/'));
    expect(adminPaths.length).toBeGreaterThanOrEqual(5);
    // The published Open Banking surface must contain nothing administrative.
    const leaked = Object.keys(paths).filter((path) => path.startsWith('/v1/') && /admin|module\/config|tpp\/registration/.test(path));
    expect(leaked).toEqual([]);
  });

  it('declares the admin security scheme on each of them, not the TPP one', () => {
    for (const path of ADMIN_PATHS) {
      const operations = paths[path];
      expect(operations, `${path} is not published`).toBeDefined();
      for (const operation of Object.values(operations!)) {
        if (!operation?.security) continue;
        const schemes = operation.security.flatMap((entry) => Object.keys(entry as Record<string, unknown>));
        expect(schemes, `${path} must be admin protected`).toContain('adminAuth');
        expect(schemes, `${path} must not accept a TPP token`).not.toContain('tppToken');
      }
    }
  });

  it('refuses every administration route without a token', async () => {
    for (const [method, url] of ADMIN_ROUTES) {
      const response = await app.inject({ method: method as 'GET', url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('refuses a valid platform token that is not an admin', async () => {
    const response = await app.inject({
      method: 'GET', url: '/api/v1/admin/module/config',
      headers: { authorization: `Bearer ${await NOT_ADMIN()}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a TPP access token: a third party does not configure the bank', async () => {
    const response = await app.inject({
      method: 'GET', url: '/api/v1/admin/module/config',
      headers: { authorization: `Bearer ${await TPP()}` },
    });
    /**
     * 403 rather than 401, and the change is the improvement.
     *
     * The token used to be signed with the bank's own key, so presenting it here failed at
     * AUTHENTICATION and the surface answered 401. Both tokens now come from the same authority and
     * both verify, so a third party's machine token is a valid credential that simply does not carry
     * the permission: it is refused at authorisation, which is what 403 means.
     *
     * The property under test is unchanged and is arguably better demonstrated. A refusal that
     * survives the token being genuinely valid is a stronger separation than one that depended on
     * the two mechanisms using different keys.
     */
    expect(response.statusCode).toBe(403);
  });

  it('documents that a configuration change needs no redeploy, which is the point of the surface', () => {
    const description = paths['/api/v1/admin/module/config/{capability}'].put.description ?? '';
    expect(description).toContain('next invocation');
    // And that it replaces rather than patches, which is what lets an operator remove an entry.
    expect(description).toContain('REPLACES');
  });

  it('documents that a rotated secret is returned once and never again', () => {
    const description = paths['/api/v1/admin/tpp/registrations/{reference}/secret/rotate'].post.description ?? '';
    expect(description).toContain('ONCE');
  });

  it('states which consent statuses the bank may set, and why not the others', () => {
    const description = paths['/api/v1/admin/consents/{consentId}/status'].patch.description ?? '';
    for (const status of ['valid', 'rejected', 'revokedByPsu', 'expired', 'terminatedByTpp']) {
      expect(description, `${status} must be discussed`).toContain(status);
    }
  });
});

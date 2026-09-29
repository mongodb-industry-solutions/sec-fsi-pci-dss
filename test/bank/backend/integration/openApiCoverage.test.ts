// v37: bankcore's external API is strictly Open Banking, and every endpoint is documented.
//
// This is a gate, not a description. It runs against the real app, so it fails the moment someone adds
// a route that is undocumented, untagged, or shaped like a private convenience call. The plan already
// says a non standard route is "a design failure to be raised instead of implemented"; this is what
// makes that mechanical instead of a matter of review attention.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../bank/backend/bin/server';

// The Berlin Group NextGenPSD2 surface lives at /v1/*, exactly as the specification writes it. A
// standard client must not need to know about a vendor prefix.
const OPEN_BANKING_PREFIX = '/v1/';

// Everything else that may exist, and why. Anything outside these two sets is a design failure.
const INFRASTRUCTURE_PATHS = new Set([
  '/',            // redirect to the docs
  '/health',      // infrastructure probe, the path the deploy platform expects
  // Discovery, not an API: a receiver looks for a key set here or it does not look at all. Public by
  // design, since a public key is for publishing.
  '/.well-known/jwks.json',
]);
const DIAGNOSTIC_PREFIX = '/api/v1/system/';
// Bank administration: engine configuration, TPP registrations, consent decisions. Plain REST and
// deliberately NOT at /v1, because no Open Banking standard covers "configure the card simulator" or
// "suspend a TPP", and putting them on the surface a TPP integrates against would make that surface
// non-standard. Admin-token protected, and reached by the browser only through the PSP.
const ADMIN_PREFIX = '/api/v1/admin/';

interface OpenApiOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  responses?: Record<string, unknown>;
  security?: unknown[];
}
type OpenApiPaths = Record<string, Record<string, OpenApiOperation>>;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

describe('v37: bankcore exposes an Open Banking API, fully documented', () => {
  let app: FastifyInstance;
  let paths: OpenApiPaths;
  // Every route the app actually serves, as "METHOD path".
  const routes: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    paths = (app as unknown as { swagger: () => { paths?: OpenApiPaths } }).swagger().paths ?? {};

    // printRoutes renders a TREE, so a node's full path is the concatenation of its ancestors'
    // fragments. Reading only the fragment silently drops the prefix, which would make this check
    // pass for routes that are not documented at all: exactly the failure it exists to catch.
    const stack: Array<{ indent: number; fragment: string }> = [];
    for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
      const match = /^([\s│├└─]*)(\S+)\s+\(([A-Z, ]+)\)\s*$/.exec(line);
      if (!match) continue;
      const indent = match[1].length;
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
      stack.push({ indent, fragment: match[2] });
      const path = stack.map((node) => node.fragment).join('').replace(/\/{2,}/g, '/');
      for (const method of match[3].split(',').map((m) => m.trim()).filter(Boolean)) {
        if (method === 'HEAD' || method === 'OPTIONS') continue;
        routes.push(`${method} ${path}`);
      }
    }
  });

  afterAll(async () => { if (app) await app.close(); });

  it('serves routes at all, so the checks below are not vacuous', () => {
    expect(Object.keys(paths).length).toBeGreaterThan(0);
  });

  it('every documented path is either the Open Banking surface, diagnostics, or infrastructure', () => {
    const offenders = Object.keys(paths).filter((path) => (
      !path.startsWith(OPEN_BANKING_PREFIX)
      && !path.startsWith(DIAGNOSTIC_PREFIX)
      && !path.startsWith(ADMIN_PREFIX)
      && !INFRASTRUCTURE_PATHS.has(path)
    ));
    expect(offenders, 'a private convenience route is a design failure, not a shortcut').toEqual([]);
  });

  it('every documented operation carries a summary, a tag and a described response', () => {
    const undocumented: string[] = [];
    for (const [path, operations] of Object.entries(paths)) {
      for (const method of HTTP_METHODS) {
        const operation = operations[method];
        if (!operation) continue;
        if (!operation.summary) undocumented.push(`${method.toUpperCase()} ${path}: no summary`);
        if (!operation.tags?.length) undocumented.push(`${method.toUpperCase()} ${path}: no tag`);
        if (!operation.responses || Object.keys(operation.responses).length === 0) {
          undocumented.push(`${method.toUpperCase()} ${path}: no documented response`);
        }
      }
    }
    expect(undocumented).toEqual([]);
  });

  it('every served route appears in the OpenAPI document', () => {
    // Swagger UI's own assets and the spec endpoints are the documentation, not the API.
    const isDocumentationItself = (path: string): boolean => path === '/doc' || path.startsWith('/doc/');
    const documented = new Set<string>();
    for (const [path, operations] of Object.entries(paths)) {
      for (const method of HTTP_METHODS) {
        if (operations[method]) documented.add(`${method.toUpperCase()} ${path}`);
      }
    }

    const missing = routes.filter((route) => {
      const [method, path] = route.split(' ');
      if (isDocumentationItself(path) || path.includes('*')) return false;
      // Fastify writes parameters as :name, OpenAPI as {name}.
      const openApiPath = path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      return !documented.has(`${method} ${openApiPath}`);
    });
    expect(missing, 'an endpoint that is not in Swagger does not exist for a TPP').toEqual([]);
  });

  it('the specification declares the TPP security scheme, which is what protects the API', () => {
    const spec = (app as unknown as { swagger: () => { components?: { securitySchemes?: Record<string, unknown> } } }).swagger();
    expect(Object.keys(spec.components?.securitySchemes ?? {})).toContain('tppToken');
  });

  it('states plainly what is deliberately not implemented, rather than leaving it absent', () => {
    const spec = (app as unknown as { swagger: () => { info: { description?: string } } }).swagger();
    const description = spec.info.description ?? '';
    for (const omission of ['SCA', 'mTLS', 'eIDAS', 'FAPI']) {
      expect(description, `${omission} must be named as out of scope`).toContain(omission);
    }
  });

  it('publishes a server a browser reading the docs can reach', () => {
    const spec = (app as unknown as { swagger: () => { servers?: Array<{ url: string }> } }).swagger();
    expect((spec.servers ?? []).length).toBeGreaterThan(0);
  });
});

// v37 P0 support for the contract baselines: the surface tier needs no DB, the live tiers need a real
// connection (read-only on MONGODB_URI, writes on TEST_MONGODB_URI).
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../../psp/backend/bin/server';
import { authorityToken, stopAuthority } from './authorityToken';
import { clientSecretFor } from '@leafypay/platform-links';

export { stopAuthority };

const BACKEND_DATA = resolve(__dirname, '../../../../../psp/backend/data');

export const LIVE_READ = Boolean(process.env.TEST_MONGODB_URI ?? process.env.MONGODB_URI);
export const LIVE_WRITE = Boolean(process.env.TEST_MONGODB_URI);

// Leafy Wallet's seeded OAuth client (data/merchants.json, m0000002).
export const WALLET_CLIENT_ID = 'f1dc0169-4f90-402c-adc8-f7e2c5c0fc7d';

// Scopes Leafy Wallet's client must keep, per the plan's Invariants section.
export const WALLET_REQUIRED_SCOPES = [
  'openid', 'profile', 'email',
  'read:beneficiaries', 'write:beneficiaries', 'write:transfers',
  'read:accounts', 'read:transactions', 'read:rtp', 'write:rtp',
];

export function readSeedFile<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(resolve(BACKEND_DATA, name), 'utf8')) as T;
}

// Builds the PSP app once per suite; works without a database, which the surface tier relies on.
export async function buildContractApp(): Promise<FastifyInstance> {
  if (process.env.TEST_MONGODB_URI) {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    process.env.MONGODB_DB_NAME = process.env.TEST_MONGODB_DB_NAME ?? 'pci_dss_test';
  }
  const app = await buildApp();
  await app.ready();
  return app;
}

// The live tiers are opportunistic: they need a real connection AND a seeded database, not just a
// configured URI. Two environment conditions are not contract breaks and must not read as ones:
// under load the shared cluster can refuse a connection (the app then starts degraded with the OAuth
// key provider uninitialised), and a freshly created database answers every read with nothing. The
// surface tier stays the deterministic judge in both cases.
export async function requireLive(
  app: FastifyInstance,
  ctx: { skip: (note?: string) => void },
): Promise<boolean> {
  if (app?.dbError != null) {
    ctx.skip(`live tier skipped: database degraded (${app.dbError})`);
    return false;
  }
  const seeded = await app.db.collection('customerAuthenticationAssessment')
    .countDocuments({}, { limit: 1 })
    .catch(() => 0);
  if (seeded === 0) {
    ctx.skip('live tier skipped: database is not seeded (run npm run setup:reset)');
    return false;
  }
  return true;
}

// Closes the app after letting fire-and-forget audit writes drain: several handlers deliberately
// audit off-request, and closing under them raises "client was closed" as a suite-level error.
export async function closeContractApp(app: FastifyInstance | undefined): Promise<void> {
  if (!app) return;
  await new Promise((r) => setTimeout(r, 500));
  await app.close();
}

/**
 * A real token for a persona, obtained from the identity authority by RFC 8693 token exchange.
 *
 * It used to be minted here with this application's own signing key. That key is gone, so a test
 * cannot forge a token this application will accept even if it wanted to, which is the extraction
 * working as intended. What a suite asserts changes accordingly: it used to prove an endpoint
 * accepts a token the test made up, and it now proves the endpoint accepts one the authority issued.
 *
 * Exchange rather than a sign-in, because these suites name a SUBJECT and hold no password for it.
 * The authority refuses any subject that is not a declared demo persona, so this cannot become a way
 * to obtain a token for an arbitrary principal.
 */
export async function mintOAuthToken(sub: string, scopes: string[], _clientId: string): Promise<string> {
  const own = await authorityToken('leafypay-simulator', clientSecretFor('leafypay-simulator'));
  if (!own) throw new Error('the identity authority is not reachable, so no token can be obtained');

  const response = await fetch('http://127.0.0.1:8085/realms/leafypay/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: own,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_subject: sub,
      scope: scopes.join(' '),
      client_id: 'leafypay-simulator',
      client_secret: clientSecretFor('leafypay-simulator'),
    }),
  });
  if (!response.ok) {
    throw new Error(`the authority refused a token for ${sub}: ${response.status}`);
  }
  return (await response.json() as { access_token: string }).access_token;
}

function openApiPaths(app: FastifyInstance): Record<string, Record<string, unknown>> {
  const spec = (app as unknown as { swagger: () => { paths?: Record<string, Record<string, unknown>> } }).swagger();
  return spec.paths ?? {};
}

// True when the OpenAPI document declares `method` on `declaredPath` (collections carry a slash).
export function routeDeclared(app: FastifyInstance, method: string, declaredPath: string): boolean {
  const paths = openApiPaths(app);
  const candidates = [declaredPath, `${declaredPath}/`, declaredPath.replace(/\/$/, '')];
  return candidates.some((p) => Boolean(paths[p]?.[method.toLowerCase()]));
}

// Two signals, because a handler may legitimately 404 on an unknown id and an undocumented route
// would be missing from the OpenAPI document while still working.
export async function routeExists(
  app: FastifyInstance,
  method: string,
  url: string,
  declaredPath?: string,
): Promise<boolean> {
  const res = await app.inject({ method: method as 'GET', url });
  if (res.statusCode !== 404) return true;
  return declaredPath ? routeDeclared(app, method, declaredPath) : false;
}

// The `required` blocks declared anywhere on a documented operation.
export function requiredBlocks(app: FastifyInstance, declaredPath: string): string[] {
  const paths = openApiPaths(app);
  const entry = paths[declaredPath] ?? paths[`${declaredPath}/`] ?? paths[declaredPath.replace(/\/$/, '')];
  if (!entry) return [];
  return JSON.stringify(entry).match(/"required":\s*\[[^\]]*\]/g) ?? [];
}

// The declared 200 schema. A strict one silently drops undeclared fields, so it is asserted on.
export function responseSchema(app: FastifyInstance, method: string, path: string): unknown {
  const paths = openApiPaths(app) as Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }>>;
  const entry = (paths[path] ?? paths[`${path}/`] ?? paths[path.replace(/\/$/, '')])?.[method.toLowerCase()];
  return entry?.responses?.['200']?.content?.['application/json']?.schema;
}

// True when the schema cannot strip `field`: no schema, additionalProperties open, or declared.
export function schemaKeepsField(schema: unknown, field: string): boolean {
  if (!schema || typeof schema !== 'object') return true;
  return JSON.stringify(schema).includes(`"${field}"`)
    || !JSON.stringify(schema).includes('"additionalProperties":false');
}

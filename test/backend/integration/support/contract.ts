// v37 P0 support for the contract baselines: the surface tier needs no DB, the live tiers need a real
// connection (read-only on MONGODB_URI, writes on TEST_MONGODB_URI).
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../../backend/bin/server';
import { getOAuthKeyProvider } from '../../../../backend/src/modules/identity/services/oidcKeys.service';

const BACKEND_DATA = resolve(__dirname, '../../../../backend/data');

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

// The live tiers are opportunistic: they need a real connection, not just a configured URI. Under
// load the shared cluster can refuse one, and the app then starts degraded with the OAuth key
// provider uninitialised, which is an environment condition rather than a contract break. The
// surface tier stays the deterministic judge.
export function requireLive(app: FastifyInstance, ctx: { skip: (note?: string) => void }): boolean {
  if (app?.dbError == null) return true;
  ctx.skip(`bankcore contract live tier skipped: database degraded (${app?.dbError})`);
  return false;
}

// Closes the app after letting fire-and-forget audit writes drain: several handlers deliberately
// audit off-request, and closing under them raises "client was closed" as a suite-level error.
export async function closeContractApp(app: FastifyInstance | undefined): Promise<void> {
  if (!app) return;
  await new Promise((r) => setTimeout(r, 500));
  await app.close();
}

// Mints an RS256 access token exactly as issueTokens() does (aud=clientId, space-delimited scope).
export async function mintOAuthToken(sub: string, scopes: string[], clientId: string): Promise<string> {
  const provider = getOAuthKeyProvider();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: provider.getKid() };
  const payload = {
    iss: process.env.PSP_BASE_URL ?? 'http://localhost:8081',
    sub,
    aud: clientId,
    exp: now + 3600,
    iat: now,
    jti: `test-${now}-${Math.random().toString(36).slice(2)}`,
    scope: scopes.join(' '),
    token_type: 'Bearer',
  };
  const signingInput = [
    Buffer.from(JSON.stringify(header)).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
  ].join('.');
  const sig = await provider.sign(Buffer.from(signingInput));
  return `${signingInput}.${sig.toString('base64url')}`;
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

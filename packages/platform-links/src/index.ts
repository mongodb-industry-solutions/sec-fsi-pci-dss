import { createHash } from 'crypto';

// Environment aware service links, resolved once and shared by both seeders.
//
// The environment is read at SEED time to write an absolute endpoint into a record; at runtime only
// the record is read. There is no runtime fallback to the environment, because a silent fallback is
// how two environments end up disagreeing about where the bank is.
//
// Two kinds of URL, and they are not interchangeable: a private one is an in-cluster service name for
// server to server calls, a public one is an ingress hostname a browser can reach. bankcore is
// private only, on purpose.
export type LinkKind = 'private' | 'public';

export interface PlatformLinks {
  // Private, service to service. The only bankcore URL there is.
  bankcoreBaseUrl: string;
  // Private PSP host, used by bankcore for its callbacks to the registered TPP.
  pspBaseUrl: string;
  // Public PSP frontend, the only browser facing link in this set.
  pspFrontendUrl: string;
  // The identity authority. Every token in the platform is issued here, by any application, for any
  // audience, so a seeded token endpoint resolves against this and never against the resource server
  // it will later be presented to.
  authorityBaseUrl: string;
}

const DEFAULTS = {
  bankcoreBaseUrl: 'http://localhost:8083',
  pspBaseUrl: 'http://127.0.0.1:8081',
  pspFrontendUrl: 'http://localhost:3000',
  authorityBaseUrl: 'http://127.0.0.1:8085',
};

type Env = Record<string, string | undefined>;

function read(env: Env, name: string, fallback: string): string {
  const value = env[`PSP_${name}`] ?? env[name];
  return value && value.trim() ? value.trim() : fallback;
}

export function resolvePlatformLinks(env: Env = process.env): PlatformLinks {
  return {
    bankcoreBaseUrl: stripTrailingSlash(read(env, 'BANKCORE_BASE_URL', DEFAULTS.bankcoreBaseUrl)),
    pspBaseUrl: stripTrailingSlash(read(env, 'BASE_URL', DEFAULTS.pspBaseUrl)),
    pspFrontendUrl: stripTrailingSlash(read(env, 'URL_FRONTEND', DEFAULTS.pspFrontendUrl)),
    authorityBaseUrl: stripTrailingSlash(
      env.GIAM_ISSUER_URL?.trim() || read(env, 'GIAM_BASE_URL', DEFAULTS.authorityBaseUrl),
    ),
  };
}

export function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

// Joins a resolved host with a relative path. Seed fixtures keep the relative path and stay
// hostname free; only the seeder produces the absolute value.
export function absoluteEndpoint(baseUrl: string, path: string): string {
  return `${stripTrailingSlash(baseUrl)}/${path.replace(/^\//, '')}`;
}

export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// A hostname with no dot is an in-cluster service name (or localhost): reachable server to server,
// never from a browser. This is what lets validateSetup catch a private host on a public record.
export function linkKind(value: string): LinkKind | 'invalid' {
  if (!isAbsoluteHttpUrl(value)) return 'invalid';
  const { hostname } = new URL(value);
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === 'host.docker.internal') return 'private';
  if (!hostname.includes('.')) return 'private';
  return 'public';
}

export interface LinkAssertion {
  name: string;
  value: string;
  expected: LinkKind;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal']);

function isLoopback(value: string): boolean {
  try { return LOOPBACK_HOSTS.has(new URL(value).hostname); } catch { return false; }
}

// Local development is the exception: there every host is loopback, so a public record legitimately
// carries a private-looking hostname and only malformed values are reported. The test is loopback
// specifically, not "private": an in-cluster service name on a browser facing record IS the defect.
export function assertLinks(assertions: LinkAssertion[]): Array<{ name: string; ok: boolean; detail?: string }> {
  const localOnly = assertions.every((a) => isLoopback(a.value));
  return assertions.map(({ name, value, expected }) => {
    const kind = linkKind(value);
    if (kind === 'invalid') return { name, ok: false, detail: `not an absolute http(s) URL: "${value}"` };
    if (expected === 'public' && kind === 'private' && !localOnly) {
      return { name, ok: false, detail: `browser facing record carries a private hostname: "${value}"` };
    }
    return { name, ok: true, detail: `${kind}: ${value}` };
  });
}

/**
 * The demo client secret for a client id.
 *
 * WHAT THIS IS FOR, because it decides everything below: preconfiguring the demo integration between
 * the applications and the authority, and nothing else. In a real deployment these credentials are
 * issued by the authority and delivered to each integrator out of band, and none of this runs.
 *
 * So the value is deliberately fixed and reproducible. A literal in a checked-in fixture is what this
 * removes, because it is indistinguishable, to a scanner and to a reader, from a real credential that
 * leaked. It does not pretend the result is secret: anyone with the source can compute it, and for a
 * demo credential that is the correct trade. The alternative, generating one per seed, would mean the
 * merchant, the wallet, the simulator and two backends could no longer know what to present, since
 * every one of them reads its secret from its own configuration.
 *
 * Domain separated and length prefixed on the client id, so two clients never share a secret and no
 * two ids collide. What is STORED remains a bcrypt hash; this is only what gets presented.
 */
const DEMO_SECRET_ROOT = 'giam-demo-client-secret-root';

/**
 * Clients whose secret an operator may already have pinned outside the authority.
 *
 * When one of these variables is set it WINS, because the application presenting the secret reads the
 * same variable: deriving instead would seed one value and present another, and that fails at the
 * token endpoint as `invalid_client`, which reads like a wrong password rather than a misconfiguration.
 * The table lives here so the seeder and every caller resolve a secret through one function: two
 * copies of this precedence is how they drift.
 */
export const CLIENT_SECRET_REFS: Readonly<Record<string, string>> = {
  'oauth001-0000-4000-8000-000000000001': 'PSP_MERCHANT_OAUTH_CLIENT_SECRET',
  'leafypay-simulator': 'NEXT_PUBLIC_PSP_SIMULATOR_CLIENT_SECRET',
};

export function clientSecretFor(clientId: string, env: NodeJS.ProcessEnv = process.env): string {
  const ref = CLIENT_SECRET_REFS[clientId];
  const held = ref ? env[ref]?.trim() : undefined;
  if (held) return held;

  // Length-prefixed so no two different client ids can produce the same input to the hash.
  return createHash('sha256')
    .update(`giam:client-secret:${clientId.length}:${clientId}:${DEMO_SECRET_ROOT}`)
    .digest('base64url');
}

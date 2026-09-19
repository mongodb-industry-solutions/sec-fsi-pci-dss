import { createHash } from 'crypto';

// Environment aware service links, resolved once and shared by both seeders.
//
// Two kinds of URL, and they are not interchangeable: a private one is an in-cluster service name for
// server to server calls, a public one is an ingress hostname a browser can reach. bankcore is
// private only, on purpose.
//
// WHERE THE HOST IS BOUND. A record stores a NAMED LINK (`{{bankcore}}`) and the host is bound when
// the record is used, not when it is written. The seeder used to resolve the absolute URL, on the
// grounds that a runtime fallback to the environment is how two environments come to disagree about
// where the bank is. That reasoning holds for a FALLBACK and does not hold for what this is: the
// record still names exactly which service it wants, and the only late part is that service's
// address in the environment the process is actually running in.
//
// What the seed-time binding could not survive is the thing this platform actually does: the same
// database is restored across environments, and in Kanopy or Drone the bank is not at the host it
// was seeded with. It is not even the same KIND of host, because inter-service traffic in staging
// takes an in-cluster name while local development is all loopback. A baked host does not degrade
// there, it sends production traffic at whatever answers on a stale address.
//
// An unresolvable name is still a hard failure (`resolveLinks` throws): that is the property the
// original reasoning was protecting, and it is kept. What is removed is the pretence that a host
// written months ago in another cluster is still the right answer.
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

/**
 * The environments this platform is deployed to. One name, selected by one variable.
 */
export const PLATFORM_ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type PlatformEnvironment = typeof PLATFORM_ENVIRONMENTS[number];

/**
 * EVERY address of every link, in every environment, declared once.
 *
 * This is the table the deployment variable selects a column from. It exists because the addresses
 * were previously spread across three places that no process could see at the same time (a local
 * `.env`, `environments/staging.yaml`, `environments/production.yaml`), so "is this configured
 * correctly for staging" could only be answered by deploying to staging. With the whole matrix in
 * one place, promoting an environment is one variable, and a missing address is visible while
 * reading rather than at the first dispatch.
 *
 * The values are exactly what the manifests already set, so declaring them here changes nothing by
 * itself. A per-link variable still WINS over this table (see `read`), which is what keeps those
 * manifests authoritative where they differ and lets an operator repoint one service without
 * editing a shared file.
 *
 * In-cluster service names in staging and production, on purpose: these are server-to-server links.
 * `pspFrontend` is the exception and the only browser-facing one, so it carries the ingress host,
 * and `assertLinks` is what catches the two being confused.
 */
export const LINK_MATRIX: Record<LinkName, Record<PlatformEnvironment, string>> = {
  bankcore: {
    development: 'http://localhost:8083',
    staging: 'http://sec-fsi-pci-dss-bankcore-web-app:80',
    production: 'http://sec-fsi-pci-dss-bankcore-web-app:80',
  },
  psp: {
    development: 'http://127.0.0.1:8081',
    staging: 'http://sec-fsi-pci-dss-backend-web-app:80',
    production: 'http://sec-fsi-pci-dss-backend-web-app:80',
  },
  pspFrontend: {
    development: 'http://localhost:3000',
    staging: 'https://sec-fsi-pci-dss-frontend.industrysolutions.staging.corp.mongodb.com',
    production: 'https://sec-fsi-pci-dss-frontend.industrysolutions.prod.corp.mongodb.com',
  },
  authority: {
    development: 'http://127.0.0.1:8085',
    // `sec-giam-api-web-app`, not `sec-giam-web-app`: GIAM's own drone step publishes the release as
    // `sec-giam-api`, and the four call sites in each manifest that named the other host broke every
    // server-to-server call (discovery, token exchange, introspection, JWKS) while browser login kept
    // working. `environments/*.yaml` is the authority for these values and `linkMatrix.test.ts`
    // asserts this table still agrees with it.
    staging: 'http://sec-giam-api-web-app:80',
    production: 'http://sec-giam-api-web-app:80',
  },
  // Derived from `authority` plus the realm, never set directly. Present so the record can name it.
  authorityIssuer: { development: '', staging: '', production: '' },
};

type Env = Record<string, string | undefined>;

/**
 * Which column of the matrix applies.
 *
 * An unrecognised name THROWS rather than falling back to development. A typo in the deployment
 * variable would otherwise point a production process at localhost, which is the exact class of
 * failure this whole indirection exists to remove.
 */
export function platformEnvironment(env: Env = process.env): PlatformEnvironment {
  const raw = (env.PSP_ENVIRONMENT ?? env.ENVIRONMENT ?? '').trim();
  if (!raw) return 'development';
  const match = PLATFORM_ENVIRONMENTS.find((name) => name === raw.toLowerCase());
  if (!match) {
    throw new Error(
      `unknown platform environment "${raw}"; expected one of ${PLATFORM_ENVIRONMENTS.join(', ')}`,
    );
  }
  return match;
}

/**
 * A link's address: the per-link variable if one is set, otherwise this environment's column.
 *
 * That precedence and not the reverse. The variable is the narrower statement, made by whoever is
 * deploying this exact process, and the table is the platform's default for the environment.
 */
function read(env: Env, name: string, link: LinkName): string {
  const value = (env[`PSP_${name}`] ?? env[name])?.trim();
  /**
   * Only an ABSOLUTE http(s) URL is accepted from the environment; anything else falls through to
   * the matrix.
   *
   * THE DEFECT THIS FIXES. This repository's own environment sets `BASE_URL=/`, which is not a host
   * at all. The previous test was "non-blank", so `/` was accepted, `stripTrailingSlash` reduced it
   * to the empty string, and the PSP link resolved to nothing: every callback address built from it
   * was a path with no host in front of it. A bare `localhost:8081` fails the same way and was
   * equally accepted. A value that cannot be a host is not a narrower statement about where the
   * service is, it is a mistake, and the environment's default is a better answer than nothing.
   */
  if (value && isAbsoluteHttpUrl(value)) return value;
  return LINK_MATRIX[link][platformEnvironment(env)];
}

export function resolvePlatformLinks(env: Env = process.env): PlatformLinks {
  return {
    bankcoreBaseUrl: stripTrailingSlash(read(env, 'BANKCORE_BASE_URL', 'bankcore')),
    pspBaseUrl: stripTrailingSlash(read(env, 'BASE_URL', 'psp')),
    pspFrontendUrl: stripTrailingSlash(read(env, 'URL_FRONTEND', 'pspFrontend')),
    authorityBaseUrl: stripTrailingSlash(
      env.GIAM_ISSUER_URL?.trim() || read(env, 'GIAM_BASE_URL', 'authority'),
    ),
  };
}

export function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * The links a stored record is allowed to name, and nothing else.
 *
 * A CLOSED set rather than "expand any environment variable": a record that could name an arbitrary
 * variable can name one that is unset in exactly one environment, and the failure would land at
 * dispatch time on a real payment. These four are what the platform has, they are validated at
 * startup by `assertLinks`, and a name outside the set is refused at the moment it is read.
 */
export const LINK_NAMES = ['bankcore', 'psp', 'pspFrontend', 'authority', 'authorityIssuer'] as const;
export type LinkName = typeof LINK_NAMES[number];

/**
 * The realm the platform's tokens are issued in, when the configured base URL does not name one.
 *
 * The bank is a CLIENT of this realm and not a realm of its own (ADR-003): what separates the two
 * institutions is the bank's own resource server, roles and token audience, none of which needs a
 * second directory.
 */
const DEFAULT_REALM = 'LeafyIdp';

/**
 * The issuer, realm included, from a base URL that may or may not already name one.
 *
 * Both shapes are in use: `GIAM_ISSUER_URL` is the issuer and carries the realm, while
 * `GIAM_BASE_URL` and the default are the authority's ORIGIN and do not. Appending blindly gave
 * `/realms/LeafyIdp/realms/...` under the first and the right answer under the second, which is the
 * kind of difference that only shows up in one deployment. Lives here rather than in a seeder so the
 * seed-time and runtime answers cannot drift apart.
 */
export function authorityIssuerUrl(env: Env = process.env): string {
  const { authorityBaseUrl } = resolvePlatformLinks(env);
  if (/\/realms\/[^/]+/.test(authorityBaseUrl)) return authorityBaseUrl;
  // The realm is not a link and has no per-environment column: one directory serves every
  // environment's own deployment of it (ADR-003).
  const realm = (env.PSP_GIAM_REALM ?? env.GIAM_REALM ?? '').trim() || DEFAULT_REALM;
  return `${authorityBaseUrl}/realms/${realm}`;
}

/** The address of each named link in THIS environment. */
export function linkValues(env: Env = process.env): Record<LinkName, string> {
  const links = resolvePlatformLinks(env);
  return {
    bankcore: links.bankcoreBaseUrl,
    psp: links.pspBaseUrl,
    pspFrontend: links.pspFrontendUrl,
    authority: links.authorityBaseUrl,
    authorityIssuer: authorityIssuerUrl(env),
  };
}

/** Writes the placeholder a record stores in place of a host. */
export function linkPlaceholder(name: LinkName): string {
  return `{{${name}}}`;
}

const PLACEHOLDER = /\{\{([A-Za-z]+)\}\}/g;

export function hasLinkPlaceholder(value: string): boolean {
  return /\{\{[A-Za-z]+\}\}/.test(value ?? '');
}

/**
 * Binds every `{{name}}` in a stored value to this environment's address for it.
 *
 * Double braces on purpose: outbound paths are templated with SINGLE braces from the payload
 * (`/v1/accounts/{accountId}/balances`), and a syntax that collided with that would make an unmapped
 * payload field indistinguishable from an unresolvable host.
 *
 * THROWS on a name outside `LINK_NAMES`. A record naming a link this platform does not have is a
 * configuration fault, and the alternative, leaving the placeholder in the URL, turns it into an
 * outbound request to a hostname literally called `{{bankore}}`: a DNS failure three layers away
 * from the typo that caused it.
 */
export function resolveLinks(value: string, env: Env = process.env): string {
  if (!value) return value;
  const values = linkValues(env);
  return value.replace(PLACEHOLDER, (_match, name: string) => {
    const resolved = values[name as LinkName];
    if (!resolved) {
      throw new Error(
        `unknown platform link "${name}" in "${value}"; known links: ${LINK_NAMES.join(', ')}`,
      );
    }
    return resolved;
  });
}

/** `resolveLinks` for a caller that must not throw, such as a read-only admin view. */
export function tryResolveLinks(value: string, env: Env = process.env): string | undefined {
  try { return resolveLinks(value, env); } catch { return undefined; }
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
//
// A stored value that NAMES its link is bound first, so what is judged is the address this environment
// will actually dial. That makes this the one place a placeholder is proved to resolve, at startup,
// rather than at dispatch time on a real payment.
export function assertLinks(
  assertions: LinkAssertion[],
  env: Env = process.env,
): Array<{ name: string; ok: boolean; detail?: string }> {
  const bound = assertions.map((assertion) => {
    try {
      return { ...assertion, resolved: resolveLinks(assertion.value, env), error: undefined as string | undefined };
    } catch (err) {
      return { ...assertion, resolved: assertion.value, error: (err as Error).message };
    }
  });
  const localOnly = bound.every((a) => isLoopback(a.resolved));
  return bound.map(({ name, value, expected, resolved, error }) => {
    if (error) return { name, ok: false, detail: error };
    const kind = linkKind(resolved);
    if (kind === 'invalid') return { name, ok: false, detail: `not an absolute http(s) URL: "${resolved}"` };
    if (expected === 'public' && kind === 'private' && !localOnly) {
      return { name, ok: false, detail: `browser facing record carries a private hostname: "${resolved}"` };
    }
    // Both shown when they differ, because "which link" and "which host" are separate questions and an
    // operator debugging a wrong target needs to know whether the name or its binding is wrong.
    const detail = resolved === value ? `${kind}: ${resolved}` : `${kind}: ${value} -> ${resolved}`;
    return { name, ok: true, detail };
  });
}

/**
 * The demo client secret for a client id: preconfiguration only, never a production credential.
 *
 * Fixed and reproducible on purpose. It removes the literal from the fixture, where it is
 * indistinguishable from a leaked credential, without pretending the result is secret. Generating one
 * per seed was rejected: every consumer reads its secret from its own configuration, so none of them
 * would know what to present. Domain separated and length prefixed, so no two ids collide.
 */
const DEMO_SECRET_ROOT = 'giam-demo-client-secret-root';

// Clients an operator may have pinned by env var: it wins, because the app presenting the secret
// reads that same variable. Kept here so the seeder and every caller share one precedence.
export const CLIENT_SECRET_REFS: Readonly<Record<string, string>> = {
  'oauth001-0000-4000-8000-000000000001': 'PSP_MERCHANT_GIAM_CLIENT_SECRET',
  'leafypay-simulator': 'NEXT_PUBLIC_PSP_SIMULATOR_CLIENT_SECRET',
};

// Cross-repo contract: this package is vendored into sec-giam, which derives the same secrets. Changing
// this derivation on one side alone breaks every client credentials flow between the two repositories.
export function clientSecretFor(clientId: string, env: NodeJS.ProcessEnv = process.env): string {
  const ref = CLIENT_SECRET_REFS[clientId];
  const held = ref ? env[ref]?.trim() : undefined;
  if (held) return held;

  // Length-prefixed so no two different client ids can produce the same input to the hash.
  return createHash('sha256')
    .update(`giam:client-secret:${clientId.length}:${clientId}:${DEMO_SECRET_ROOT}`)
    .digest('base64url');
}

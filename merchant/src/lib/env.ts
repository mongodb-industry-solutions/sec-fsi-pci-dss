// Server-only env accessors. Secrets NEVER reach the browser (no NEXT_PUBLIC_).
// All merchant vars use the PSP_MERCHANT_ prefix.
//
// Resolution philosophy: the real process environment is the source of truth (exported vars, or
// values injected by docker-compose / Kubernetes). The .env files are OPTIONAL conveniences for
// temporarily customizing the environment, never a hard requirement. Precedence for every var:
//   process.env (incl. merchant/.env.local loaded by Next)  >  repo-root .env  >  built-in default
// Missing .env files never obstruct startup, and a missing value never throws here. Enforcement of
// "the client must be registered and authorized" lives at the PSP authorization server, which
// rejects an unknown / unauthenticated client: the merchant must not fabricate an identity, so an
// unset client id resolves to empty and the PSP declines the flow (invalid_client). The demo client
// SECRET is derived from the client id by the same function the authority seeds with, so naming a
// client is what authenticates, and naming none still authenticates as nobody.
import 'server-only';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { clientSecretFor } from '@leafypay/platform-links';

// Optional fallback: parse the repo-root .env (one level above the merchant package). Read-only,
// loaded once, best-effort. In containers the parent .env usually doesn't exist and env comes from
// process.env: this simply returns {} and nothing breaks.
let globalEnvCache: Record<string, string> | undefined;
function globalEnv(): Record<string, string> {
  if (globalEnvCache) return globalEnvCache;
  const cache: Record<string, string> = {};
  // Prefer the .env in the current working directory. Only look one level up when cwd is actually the
  // merchant package (so `next dev` from merchant/ still finds the repo-root .env), never when started
  // from the repo root: otherwise a stray .env ABOVE the repo could wrongly win ("first file wins").
  const candidates = [path.resolve(process.cwd(), '.env')];
  if (path.basename(process.cwd()) === 'merchant') {
    candidates.push(path.resolve(process.cwd(), '..', '.env')); // repo root when cwd = <root>/merchant
  }
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m) continue; // skip blank lines and comments (# ...)
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1); // quoted: keep verbatim (may legitimately contain '#')
        } else {
          val = val.replace(/\s+#.*$/, ''); // unquoted: strip an inline comment (whitespace + # ...)
        }
        if (!(m[1] in cache)) cache[m[1]] = val; // first file wins
      }
    } catch { /* unreadable file: ignore, fall through to process.env only */ }
  }
  globalEnvCache = cache;
  return cache;
}

// Resolve a var: process environment first, then the optional global .env. Never throws.
function envVar(name: string): string | undefined {
  const v = process.env[name] ?? globalEnv()[name];
  return v && v.length > 0 ? v : undefined;
}

// Ephemeral, per-process session key used ONLY when PSP_MERCHANT_SESSION_SECRET is unset. Random
// (not a predictable/forgeable hardcoded value), so the app stays usable for local dev without any
// config; sessions simply don't survive a restart / span replicas. Set the env var in real deploys.
let ephemeralSessionSecret: string | undefined;
function fallbackSessionSecret(): string {
  if (!ephemeralSessionSecret) {
    ephemeralSessionSecret = randomBytes(32).toString('base64');
    console.warn('[env] PSP_MERCHANT_SESSION_SECRET not set: using an ephemeral per-process key. Set it for stable sessions.');
  }
  return ephemeralSessionSecret;
}

/**
 * v39 P9.6: the address of the AUTHORITY and the address of the APPLICATION are now two things.
 *
 * They used to be one, and five browser-facing links were derived from it by string-replacing
 * `/auth/authorize`. Repointing the authorize URL to the identity authority would therefore have
 * dragged the portal, the dashboard, the simulator and the credentials page along with it, to a host
 * that does not serve any of them. The plan calls this the single most likely regression in the whole
 * extraction, and it is: nothing would fail at build time and four links would quietly go to the
 * wrong product.
 *
 * So the five derive from the APPLICATION's front end, which is where those pages actually live, and
 * each still accepts an explicit override.
 */
const APPLICATION_FRONTEND = 'http://localhost:8080';

function applicationFrontend(): string {
  return (envVar('PSP_MERCHANT_APP_FRONTEND_URL') ?? APPLICATION_FRONTEND).replace(/\/+$/, '');
}

export const ENV = {
  // The BUSINESS API. Stays with the application: this is where payments, beneficiaries and
  // transfers live, and none of them moved.
  pspBaseUrl: () => envVar('PSP_MERCHANT_PSP_BASE_URL') ?? 'http://localhost:8081',
  /**
   * The ISSUER. Discovery, token and introspection, at the identity authority.
   *
   * Split from the business API because they are different systems now. One environment variable
   * repoints authentication without touching a single business endpoint, which is the property that
   * makes the authority replaceable.
   */
  issuerUrl: () => envVar('PSP_MERCHANT_ISSUER_URL') ?? 'http://localhost:8085/realms/leafypay',
  // Browser-facing sign-in, at the authority. Credential entry belongs there and nowhere else.
  pspAuthorizeUrl: () => envVar('PSP_MERCHANT_AUTHORIZE_URL') ?? 'http://localhost:8086/auth/login',
  // Browser-facing PSP front-channel logout page (single sign-out): clears the PSP portal session
  // cookie same-origin, then bounces back to this app. Derived from the authorize URL by default.
  pspLogoutUrl: () => envVar('PSP_MERCHANT_LOGOUT_URL') ?? `${applicationFrontend()}/auth/logout`,
  // Browser-facing PSP portal root (same PSP frontend origin as authorize), for the "PSP portal"
  // link in the merchant UI. Derived from the authorize URL by default.
  pspPortalUrl: () => envVar('PSP_MERCHANT_PORTAL_URL') ?? `${applicationFrontend()}`,
  // Browser-facing PSP dashboard (the signed-in PSP app home). Derived from the authorize URL.
  pspDashboardUrl: () => envVar('PSP_MERCHANT_DASHBOARD_URL') ?? `${applicationFrontend()}/system`,
  // Browser-facing PSP simulator hub (same PSP frontend origin as authorize). Lets the merchant demo
  // link back to the simulator. Derived from the authorize URL by default.
  pspSimulatorUrl: () => envVar('PSP_MERCHANT_SIMULATOR_URL') ?? `${applicationFrontend()}/simulator`,
  // Browser-facing PSP passwordless credentials management page (PSP frontend). Lets the merchant link the
  // user to Sec4 Pay to manage/revoke their enrolled keys. Derived from the authorize URL by default.
  pspCredentialsUrl: () => envVar('PSP_MERCHANT_CREDENTIALS_URL') ?? `${applicationFrontend()}/system/profile/credentials`,
  // Docs links shown in /help. Both must be BROWSER-reachable in every environment.
  // Wiki: static public GitHub wiki. Swagger: the backend /doc UI, its PUBLIC URL (PSP_MERCHANT_PSP_BASE_URL
  // is the in-cluster private URL, not browser-reachable), so set PSP_MERCHANT_SWAGGER_URL per deploy;
  // the local default derives from the (locally public) API base.
  wikiUrl: () => envVar('PSP_MERCHANT_WIKI_URL') ?? 'https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/wiki',
  apiDocsUrl: () =>
    envVar('PSP_MERCHANT_SWAGGER_URL') ??
    `${envVar('PSP_MERCHANT_PSP_BASE_URL') ?? 'http://localhost:8081'}/doc`,
  // The client ID has NO built-in default: the merchant must never fabricate a client identity. If
  // unset it resolves to '' and the PSP declines the flow (invalid_client): enforcement belongs to the
  // authorization server, so an unconfigured merchant cannot authenticate, yet nothing crashes.
  clientId: () => envVar('PSP_MERCHANT_OAUTH_CLIENT_ID') ?? '',
  // The secret is different in kind: it is not an identity claim but the proof for one, and the demo
  // credential is derived from the client id by the same function the authority seeds with, so the two
  // agree without either holding a literal. Naming no client still authenticates as nobody.
  clientSecret: () => {
    const configured = envVar('PSP_MERCHANT_OAUTH_CLIENT_SECRET');
    if (configured) return configured;
    const clientId = envVar('PSP_MERCHANT_OAUTH_CLIENT_ID');
    return clientId ? clientSecretFor(clientId) : '';
  },
  // This app's public base URL (local default 8082; container listens on 8080 behind ingress).
  baseUrl: () => envVar('PSP_MERCHANT_BASE_URL') ?? 'http://localhost:8082',
  // Redirect URI defaults to <baseUrl>/api/auth/callback but can be overridden per env.
  redirectUri: () =>
    envVar('PSP_MERCHANT_REDIRECT_URI') ??
    `${envVar('PSP_MERCHANT_BASE_URL') ?? 'http://localhost:8082'}/api/auth/callback`,
  // AES-256-GCM key for the session cookie. Falls back to an ephemeral per-process key when unset
  // (dev convenience) rather than a predictable hardcoded value; set it explicitly in real deploys.
  sessionSecret: () => envVar('PSP_MERCHANT_SESSION_SECRET') ?? fallbackSessionSecret(),
  // Espresso Works seeded merchant agreement reference.
  merchantAgreementRef: () =>
    envVar('PSP_MERCHANT_AGREEMENT_REF') ?? 'm0000001-0000-4000-8000-000000000001',
};

// Scopes requested by Espresso Works (must be a subset of the seeded client's scopes).
export const REQUESTED_SCOPES = [
  'openid',
  'profile',
  'read:beneficiaries',
  'write:beneficiaries',
  'read:transactions',
  'read:accounts',
  'read:merchant_profile',
  'read:notifications',
  'write:transfers',
  'read:rtp',
  'write:rtp',
];

// Server-only env accessors. Secrets NEVER reach the browser (no NEXT_PUBLIC_).
// All merchant vars use the PSP_MERCHANT_ prefix.
//
// Resolution philosophy: the real process environment is the source of truth (exported vars, or
// values injected by docker-compose / Kubernetes). The .env files are OPTIONAL conveniences for
// temporarily customizing the environment — never a hard requirement. Precedence for every var:
//   process.env (incl. merchant/.env.local loaded by Next)  >  repo-root .env  >  built-in default
// Missing .env files never obstruct startup, and a missing value never throws here. Enforcement of
// "the client must be registered and authorized" lives at the PSP authorization server, which
// rejects an unknown / unauthenticated client — the merchant must not fabricate credentials, so an
// unset client id/secret resolves to empty and the PSP declines the flow (invalid_client).
import 'server-only';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

// Optional fallback: parse the repo-root .env (one level above the merchant package). Read-only,
// loaded once, best-effort. In containers the parent .env usually doesn't exist and env comes from
// process.env — this simply returns {} and nothing breaks.
let globalEnvCache: Record<string, string> | undefined;
function globalEnv(): Record<string, string> {
  if (globalEnvCache) return globalEnvCache;
  const cache: Record<string, string> = {};
  // Prefer the .env in the current working directory. Only look one level up when cwd is actually the
  // merchant package (so `next dev` from merchant/ still finds the repo-root .env), never when started
  // from the repo root — otherwise a stray .env ABOVE the repo could wrongly win ("first file wins").
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
    } catch { /* unreadable file — ignore, fall through to process.env only */ }
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
    console.warn('[env] PSP_MERCHANT_SESSION_SECRET not set — using an ephemeral per-process key. Set it for stable sessions.');
  }
  return ephemeralSessionSecret;
}

export const ENV = {
  // PSP API base — OIDC discovery + all API endpoints (backend, host port 8081).
  pspBaseUrl: () => envVar('PSP_MERCHANT_PSP_BASE_URL') ?? 'http://localhost:8081',
  // Browser-facing PSP consent/login page (PSP frontend). Backend /authorize returns JSON, not UI.
  pspAuthorizeUrl: () => envVar('PSP_MERCHANT_AUTHORIZE_URL') ?? 'http://localhost:8080/auth/authorize',
  // Browser-facing PSP front-channel logout page (single sign-out): clears the PSP portal session
  // cookie same-origin, then bounces back to this app. Derived from the authorize URL by default.
  pspLogoutUrl: () =>
    envVar('PSP_MERCHANT_LOGOUT_URL') ??
    (envVar('PSP_MERCHANT_AUTHORIZE_URL') ?? 'http://localhost:8080/auth/authorize').replace('/auth/authorize', '/auth/logout'),
  // Browser-facing PSP simulator hub (same PSP frontend origin as authorize). Lets the merchant demo
  // link back to the simulator. Derived from the authorize URL by default.
  pspSimulatorUrl: () =>
    envVar('PSP_MERCHANT_SIMULATOR_URL') ??
    (envVar('PSP_MERCHANT_AUTHORIZE_URL') ?? 'http://localhost:8080/auth/authorize').replace('/auth/authorize', '/simulator'),
  // Browser-facing PSP passwordless credentials management page (PSP frontend). Lets the merchant link the
  // user to Sec4 Pay to manage/revoke their enrolled keys. Derived from the authorize URL by default.
  pspCredentialsUrl: () =>
    envVar('PSP_MERCHANT_CREDENTIALS_URL') ??
    (envVar('PSP_MERCHANT_AUTHORIZE_URL') ?? 'http://localhost:8080/auth/authorize').replace('/auth/authorize', '/system/profile/credentials'),
  // Docs links shown in /help. Both must be BROWSER-reachable in every environment.
  // Wiki: static public GitHub wiki. Swagger: the backend /doc UI — its PUBLIC URL (PSP_MERCHANT_PSP_BASE_URL
  // is the in-cluster private URL, not browser-reachable), so set PSP_MERCHANT_SWAGGER_URL per deploy;
  // the local default derives from the (locally public) API base.
  wikiUrl: () => envVar('PSP_MERCHANT_WIKI_URL') ?? 'https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/wiki',
  apiDocsUrl: () =>
    envVar('PSP_MERCHANT_SWAGGER_URL') ??
    `${envVar('PSP_MERCHANT_PSP_BASE_URL') ?? 'http://localhost:8081'}/doc`,
  // Client credentials have NO built-in default: the merchant must never fabricate a client identity.
  // If unset they resolve to '' and the PSP declines the flow (invalid_client) — enforcement belongs
  // to the authorization server, so an unconfigured merchant cannot authenticate, yet nothing crashes.
  clientId: () => envVar('PSP_MERCHANT_OAUTH_CLIENT_ID') ?? '',
  clientSecret: () => envVar('PSP_MERCHANT_OAUTH_CLIENT_SECRET') ?? '',
  // This app's public base URL (local default 8082; container listens on 8080 behind ingress).
  baseUrl: () => envVar('PSP_MERCHANT_BASE_URL') ?? 'http://localhost:8082',
  // Redirect URI defaults to <baseUrl>/api/auth/callback but can be overridden per env.
  redirectUri: () =>
    envVar('PSP_MERCHANT_REDIRECT_URI') ??
    `${envVar('PSP_MERCHANT_BASE_URL') ?? 'http://localhost:8082'}/api/auth/callback`,
  // AES-256-GCM key for the session cookie. Falls back to an ephemeral per-process key when unset
  // (dev convenience) rather than a predictable hardcoded value; set it explicitly in real deploys.
  sessionSecret: () => envVar('PSP_MERCHANT_SESSION_SECRET') ?? fallbackSessionSecret(),
  // Espresso Works seeded SD-89 merchant agreement reference.
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

// Server-only OAuth2/OIDC helpers: discovery, PKCE (S256), state/nonce, id_token verify.
import 'server-only';
import { createHash, randomBytes } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ENV } from './env';
import { oauthLog } from './logger';

export interface OidcConfig {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  revocation_endpoint: string;
  jwks_uri: string;
  backchannel_authentication_endpoint?: string;
}

// Cache the discovery doc + JWKS for the process lifetime (they rarely change).
let discoveryCache: OidcConfig | null = null;
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function discover(): Promise<OidcConfig> {
  if (discoveryCache) return discoveryCache;
  const url = `${ENV.pspBaseUrl()}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    // The merchant process cannot reach the PSP base URL (wrong host/port, container networking, …).
    oauthLog.error('discover.unreachable', { url, error: (e as Error).message });
    throw new Error(`OIDC discovery unreachable at ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    oauthLog.error('discover.failed', { url, status: res.status });
    throw new Error(`OIDC discovery failed: ${res.status}`);
  }
  discoveryCache = (await res.json()) as OidcConfig;
  return discoveryCache;
}

function jwks(jwksUri: string) {
  if (!jwksCache) jwksCache = createRemoteJWKSet(new URL(jwksUri));
  return jwksCache;
}

// ── PKCE (RFC 7636 S256) + CSRF/nonce ───────────────────────────────────────────
function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export const randomToken = () => b64url(randomBytes(16));

/**
 * Build the browser-facing authorize URL. We point the user at the PSP frontend
 * consent page (PSP_AUTHORIZE_URL), which renders login+consent and then hands off
 * to the backend authorization endpoint to issue the code.
 */
export function buildAuthorizeUrl(params: {
  state: string;
  nonce: string;
  codeChallenge: string;
  scopes: string[];
}): string {
  const u = new URL(ENV.pspAuthorizeUrl());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', ENV.clientId());
  u.searchParams.set('redirect_uri', ENV.redirectUri());
  u.searchParams.set('scope', params.scopes.join(' '));
  u.searchParams.set('state', params.state);
  u.searchParams.set('nonce', params.nonce);
  u.searchParams.set('code_challenge', params.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
  refresh_token?: string;
}

// Confidential client auth via HTTP Basic (client_secret_basic).
function basicAuthHeader(): string {
  const creds = Buffer.from(`${ENV.clientId()}:${ENV.clientSecret()}`).toString('base64');
  return `Basic ${creds}`;
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
  const cfg = await discover();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: ENV.redirectUri(),
    code_verifier: codeVerifier,
    client_id: ENV.clientId(),
  });
  const res = await fetch(cfg.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body,
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
    // Surface the PSP's own error code + description (no secret) so the callback can log the real cause
    // (invalid_grant / invalid_client / redirect_uri mismatch / PKCE) instead of a bare failure.
    oauthLog.error('token.exchange.failed', {
      endpoint: cfg.token_endpoint, status: res.status, error: err.error, error_description: err.error_description,
    });
    throw new OAuthUpstreamError(err.error ?? 'token_exchange_failed', err.error_description ?? '', res.status);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const cfg = await discover();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: ENV.clientId(),
  });
  const res = await fetch(cfg.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  return (await res.json()) as TokenResponse;
}

// Item 2 (v18): obtain a SERVER-TO-SERVER access token via the OAuth client_credentials grant. This is
// the merchant's OWN machine identity (not a user token), used only for server-side merchant charges
// (write:payments). Confidential client auth (client_secret_basic); the token never reaches the browser.
export async function clientCredentialsToken(scope = 'write:payments'): Promise<TokenResponse> {
  const cfg = await discover();
  const res = await fetch(cfg.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: ENV.clientId(), scope }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`client_credentials token failed: ${res.status} ${JSON.stringify(err)}`);
  }
  return (await res.json()) as TokenResponse;
}

// ── CIBA (OIDC Client-Initiated Backchannel Authentication): v25 passwordless login ──────────────
// The merchant is a confidential CIBA client. It initiates the backchannel request (bc-authorize) and
// polls the token endpoint with the ciba grant. The browser (Authentication Device) fetches + signs the
// challenge out-of-band; the merchant server never sees the private key.

export interface BackchannelAuthorizeInput {
  loginHintToken: string;
  scope: string;
  bindingMessage?: string;
}

export interface BackchannelAuthResponse {
  auth_req_id: string;
  expires_in: number;
  interval: number;
}

// Carries the PSP's OAuth error code + description so callers can render clean UX instead of a raw
// "bc-authorize failed: 400 {…}" string.
export class OAuthUpstreamError extends Error {
  constructor(public code: string, public description: string, public status: number) {
    super(description || code);
    this.name = 'OAuthUpstreamError';
  }
}

function backchannelEndpoint(cfg: OidcConfig): string {
  // Prefer the discovered endpoint; fall back to deriving it from the token endpoint (…/token → …/bc-authorize).
  return cfg.backchannel_authentication_endpoint ?? cfg.token_endpoint.replace(/\/token$/, '/bc-authorize');
}

export async function backchannelAuthorize(input: BackchannelAuthorizeInput): Promise<BackchannelAuthResponse> {
  const cfg = await discover();
  const body = new URLSearchParams({
    login_hint_token: input.loginHintToken,
    scope: input.scope,
    client_id: ENV.clientId(),
  });
  if (input.bindingMessage) body.set('binding_message', input.bindingMessage);
  const res = await fetch(backchannelEndpoint(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body,
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
    oauthLog.error('ciba.bc_authorize.failed', { status: res.status, error: err.error, error_description: err.error_description });
    throw new OAuthUpstreamError(err.error ?? 'bc_authorize_failed', err.error_description ?? '', res.status);
  }
  const out = (await res.json()) as BackchannelAuthResponse;
  oauthLog.info('ciba.bc_authorize.ok', { authReqId: out.auth_req_id, expiresIn: out.expires_in, interval: out.interval });
  return out;
}

export interface CibaPollResult {
  status: 'done' | 'pending' | 'slow_down' | 'denied' | 'expired' | 'error';
  tokens?: TokenResponse;
  error?: string;
}

// Poll the token endpoint once with the ciba grant. Maps the OAuth error codes CIBA returns while the user
// has not yet approved (authorization_pending/slow_down) or terminal outcomes (access_denied/expired_token).
export async function cibaTokenPoll(authReqId: string): Promise<CibaPollResult> {
  const cfg = await discover();
  const res = await fetch(cfg.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body: new URLSearchParams({
      grant_type: 'urn:openid:params:grant-type:ciba',
      auth_req_id: authReqId,
      client_id: ENV.clientId(),
    }),
    cache: 'no-store',
  });
  if (res.ok) {
    oauthLog.info('ciba.poll.done', { authReqId });
    return { status: 'done', tokens: (await res.json()) as TokenResponse };
  }
  const err = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
  switch (err.error) {
    case 'authorization_pending': return { status: 'pending' };
    case 'slow_down': return { status: 'slow_down' };
    case 'access_denied':
      oauthLog.warn('ciba.poll.denied', { authReqId });
      return { status: 'denied' };
    case 'expired_token':
      oauthLog.warn('ciba.poll.expired', { authReqId });
      return { status: 'expired' };
    default:
      oauthLog.error('ciba.poll.error', { authReqId, status: res.status, error: err.error, error_description: err.error_description });
      return { status: 'error', error: err.error_description ?? err.error ?? `token poll failed: ${res.status}` };
  }
}

export async function revoke(token: string): Promise<void> {
  const cfg = await discover();
  await fetch(cfg.revocation_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body: new URLSearchParams({ token }),
    cache: 'no-store',
  }).catch(() => undefined); // RFC 7009: revoke is best-effort
}

// Call the PSP UserInfo endpoint with a freshly-issued access token (used at callback time,
// before a session cookie exists). Returns only the claims the granted scopes allow: the PSP
// gates `name`/`preferred_username` behind `profile` and `email` behind `email`. Non-fatal:
// resolves to null on any failure so login still completes from id_token claims alone.
export async function fetchUserinfo(
  accessToken: string,
): Promise<{ sub: string; name?: string; preferred_username?: string; email?: string } | null> {
  try {
    const cfg = await discover();
    const res = await fetch(cfg.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      oauthLog.warn('userinfo.failed', { status: res.status });
      return null;
    }
    return (await res.json()) as { sub: string; name?: string; preferred_username?: string; email?: string };
  } catch (e) {
    oauthLog.warn('userinfo.error', { error: (e as Error).message });
    return null;
  }
}

// Verify id_token signature (RS256, JWKS) + issuer/audience/nonce.
export async function verifyIdToken(idToken: string, expectedNonce?: string): Promise<{ sub: string; name?: string; email?: string }> {
  const cfg = await discover();
  const { payload } = await jwtVerify(idToken, jwks(cfg.jwks_uri), {
    issuer: cfg.issuer,
    audience: ENV.clientId(),
  });
  // If the authorize request carried a nonce, the id_token MUST echo the same value. A missing nonce
  // claim is a mismatch (not a pass): otherwise a token without a nonce would be accepted for a
  // request that required one, weakening replay protection (OIDC Core §3.1.3.7).
  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error('id_token nonce mismatch');
  }
  return {
    sub: payload.sub as string,
    name: payload.name as string | undefined,
    email: payload.email as string | undefined,
  };
}

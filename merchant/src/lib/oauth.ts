// Server-only OAuth2/OIDC helpers: discovery, PKCE (S256), state/nonce, id_token verify.
import 'server-only';
import { createHash, randomBytes } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ENV } from './env';

export interface OidcConfig {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  revocation_endpoint: string;
  jwks_uri: string;
}

// Cache the discovery doc + JWKS for the process lifetime (they rarely change).
let discoveryCache: OidcConfig | null = null;
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function discover(): Promise<OidcConfig> {
  if (discoveryCache) return discoveryCache;
  const res = await fetch(`${ENV.pspBaseUrl()}/.well-known/openid-configuration`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
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
    const err = await res.json().catch(() => ({}));
    throw new Error(`token exchange failed: ${res.status} ${JSON.stringify(err)}`);
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

export async function revoke(token: string): Promise<void> {
  const cfg = await discover();
  await fetch(cfg.revocation_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body: new URLSearchParams({ token }),
    cache: 'no-store',
  }).catch(() => undefined); // RFC 7009: revoke is best-effort
}

// Verify id_token signature (RS256, JWKS) + issuer/audience/nonce.
export async function verifyIdToken(idToken: string, expectedNonce?: string): Promise<{ sub: string; name?: string; email?: string }> {
  const cfg = await discover();
  const { payload } = await jwtVerify(idToken, jwks(cfg.jwks_uri), {
    issuer: cfg.issuer,
    audience: ENV.clientId(),
  });
  if (expectedNonce && payload.nonce && payload.nonce !== expectedNonce) {
    throw new Error('id_token nonce mismatch');
  }
  return {
    sub: payload.sub as string,
    name: payload.name as string | undefined,
    email: payload.email as string | undefined,
  };
}

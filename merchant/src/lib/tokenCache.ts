// Process-level, single-flight OAuth token cache (server-only).
//
// Why: on the render/read path a PspClient cannot persist a rotated token to the
// session cookie (Set-Cookie is illegal during RSC render). Without a shared cache
// every render — and every helper that builds its own client (page fetch +
// loadAccountOptions + userinfo) — re-refreshes via POST /auth/token, producing a
// token storm and 30 to 60s pile-ups against the encrypted PSP backend.
//
// This module keeps the freshest access token per user (session `sub`) in memory for
// the Next.js server process lifetime and de-duplicates concurrent refreshes into a
// single in-flight promise, so the token is acquired once and reused across renders
// and requests within its TTL.
import 'server-only';
import { refreshTokens, clientCredentialsToken } from './oauth';
import { expiresAtFrom } from './expiry';

export interface CachedToken {
  accessToken: string;
  refreshToken: string;
  grantedScopes: string[];
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

// Freshest known token per session `sub`.
const tokenBySub = new Map<string, CachedToken>();
// In-flight refresh per `sub` (single-flight de-dup of concurrent refreshes).
const refreshInFlight = new Map<string, Promise<CachedToken>>();

const SKEW_MS = 5000;

/** Return a cached token for this user if it is still comfortably valid, else null. */
export function peekToken(sub: string): CachedToken | null {
  const t = tokenBySub.get(sub);
  return t && Date.now() < t.expiresAt - SKEW_MS ? t : null;
}

/** Seed/refresh the cache from a token the caller already holds (e.g. a valid cookie token). */
export function primeToken(sub: string, t: CachedToken): void {
  const existing = tokenBySub.get(sub);
  if (!existing || t.expiresAt >= existing.expiresAt) tokenBySub.set(sub, t);
}

/**
 * Return a fresh access token for this user, reusing the process cache and coalescing
 * concurrent refreshes into a single POST /auth/token. Callers pass the current refresh
 * token (from the session cookie); the freshest rotated token wins.
 */
export async function getFreshUserToken(
  sub: string,
  refreshToken: string,
  grantedScopes: string[],
): Promise<CachedToken> {
  const cached = peekToken(sub);
  if (cached) return cached;

  const inFlight = refreshInFlight.get(sub);
  if (inFlight) return inFlight;

  const p = (async (): Promise<CachedToken> => {
    const t = await refreshTokens(refreshToken);
    const next: CachedToken = {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? refreshToken,
      grantedScopes: t.scope ? t.scope.split(' ').filter(Boolean) : grantedScopes,
      expiresAt: expiresAtFrom(t.expires_in),
    };
    tokenBySub.set(sub, next);
    return next;
  })().finally(() => {
    refreshInFlight.delete(sub);
  });

  refreshInFlight.set(sub, p);
  return p;
}

// ── client_credentials (server-to-server machine token) cache ────────────────────
// The merchant's own machine identity token (write:payments) is reusable within its
// TTL. Caching it avoids a fresh POST /auth/token on every server-side charge.
const ccBypScope = new Map<string, CachedToken>();
const ccInFlight = new Map<string, Promise<string>>();

export async function getClientCredentialsToken(scope = 'write:payments'): Promise<string> {
  const cached = ccBypScope.get(scope);
  if (cached && Date.now() < cached.expiresAt - SKEW_MS) return cached.accessToken;

  const inFlight = ccInFlight.get(scope);
  if (inFlight) return inFlight;

  const p = (async (): Promise<string> => {
    const t = await clientCredentialsToken(scope);
    ccBypScope.set(scope, {
      accessToken: t.access_token,
      refreshToken: '',
      grantedScopes: t.scope ? t.scope.split(' ').filter(Boolean) : [scope],
      expiresAt: expiresAtFrom(t.expires_in),
    });
    return t.access_token;
  })().finally(() => {
    ccInFlight.delete(scope);
  });

  ccInFlight.set(scope, p);
  return p;
}

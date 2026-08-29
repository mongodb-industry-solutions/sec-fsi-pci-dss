import { config } from '../../config';

/**
 * This service's own machine token, for the calls it makes as itself.
 *
 * Not a token it mints: one it is ISSUED, by the authority, against its own registered client
 * credentials. The difference matters. A service that mints its own tokens is trusted because it
 * holds a secret the receiver also holds, which means either of them can produce a token the other
 * accepts and neither can prove which one did. A service that is issued one is trusted because the
 * authority said so, and the authority holds the only private key.
 *
 * Cached until shortly before expiry. Fetching one per call would put an authentication round trip
 * in front of every outbound request, and the token is valid for its whole lifetime by definition.
 */

interface CachedToken {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

/** Renewed slightly early, so a token never expires in flight on the receiving side. */
const RENEW_MARGIN_SECONDS = 30;

export async function authorityMachineToken(scope?: string): Promise<string | null> {
  const key = scope ?? 'default';
  const held = cache.get(key);
  if (held && held.expiresAt > Date.now()) return held.token;

  const clientId = config.giam.clientId;
  const clientSecret = config.giam.clientSecret;
  // Absent credentials mean this service was never registered to act as itself. Returning null lets
  // the caller degrade honestly rather than sending a request that will be refused.
  if (!clientId || !clientSecret) return null;

  try {
    const response = await fetch(`${config.giam.issuerUrl.replace(/\/+$/, '')}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        ...(scope ? { scope } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;

    const body = await response.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;

    cache.set(key, {
      token: body.access_token,
      expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 60) - RENEW_MARGIN_SECONDS) * 1000,
    });
    return body.access_token;
  } catch {
    return null;
  }
}

/** Drops the cache, for a test that needs the next call to fetch afresh. */
export function resetMachineTokenCache(): void {
  cache.clear();
}

import { createPublicKey, verify as cryptoVerify, KeyObject } from 'crypto';
import { config } from '../../config';

/**
 * Local verification against the authority's published keys, for the BANK's realm.
 *
 * Same mechanics as any other resource server, and the realm is the whole point. This bank verifies
 * against the key set of its OWN realm, so a token minted for the platform's realm fails the
 * signature check outright: it was signed by a different key, published at a different key set,
 * under a different issuer. That is what makes the institutional boundary structural rather than a
 * matter of the platform choosing not to mint one.
 *
 * Before this, the bank verified a PSP-ISSUED token with a shared secret, so a token minted anywhere
 * on the platform opened part of the banking API. The boundary existed in the documentation and not
 * in the key material.
 */

export interface VerifiedClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  scope: string[];
  /**
   * Full permission strings, `resource:action`.
   *
   * v40: the shape changed AND the default did. This claim is absent unless the client asked to
   * narrow, so `roles` plus the published catalog is the normal path. See `roles` below.
   */
  permissions: string[];
  roles: string[];
  /**
   * The roles expanded against the published catalog, plus anything carried explicitly.
   *
   * Set by the verifier where a catalog was available. ABSENT is a refusal, never an unrestricted
   * grant: an authority that could not be resolved must deny.
   */
  effectivePermissions?: string[];
  clientId?: string;
  sessionId?: string;
  [claim: string]: unknown;
}

interface CachedKeySet {
  keys: Map<string, KeyObject>;
  algByKid: Map<string, string>;
  fetchedAt: number;
}

let cache: CachedKeySet | null = null;
let jwksUri: string | null = null;
let inFlight: Promise<void> | null = null;
const lastRefetchByKid = new Map<string, number>();

async function discoverJwksUri(): Promise<string> {
  if (jwksUri) return jwksUri;
  const issuer = config.giam.issuerUrl.replace(/\/+$/, '');
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`discovery answered ${response.status}`);
  const metadata = await response.json() as { jwks_uri?: string };
  if (!metadata.jwks_uri) throw new Error('discovery document carries no jwks_uri');
  jwksUri = metadata.jwks_uri;
  return jwksUri;
}

async function fetchKeySet(): Promise<void> {
  const uri = await discoverJwksUri();
  const response = await fetch(uri, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`key set answered ${response.status}`);
  const document = await response.json() as { keys?: Array<Record<string, unknown>> };

  const keys = new Map<string, KeyObject>();
  const algByKid = new Map<string, string>();
  for (const jwk of document.keys ?? []) {
    const kid = typeof jwk.kid === 'string' ? jwk.kid : null;
    if (!kid) continue;
    try {
      keys.set(kid, createPublicKey({ key: jwk as never, format: 'jwk' }));
      algByKid.set(kid, typeof jwk.alg === 'string' ? jwk.alg : 'RS256');
    } catch {
      // One unparseable entry does not invalidate the rest of the set.
    }
  }
  cache = { keys, algByKid, fetchedAt: Date.now() };
}

async function ensureKeySet(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = fetchKeySet().finally(() => { inFlight = null; });
  return inFlight;
}

async function resolveKey(kid: string): Promise<{ key: KeyObject; alg: string } | null> {
  const ttl = config.giam.jwksCacheSeconds * 1000;
  if (!cache || Date.now() - cache.fetchedAt >= ttl) {
    try {
      await ensureKeySet();
    } catch {
      // A stale set is safe and an unreachable authority must not close the bank: an old public key
      // validates only what the authority itself signed.
      if (!cache) return null;
    }
  }

  const existing = cache?.keys.get(kid);
  if (existing) return { key: existing, alg: cache!.algByKid.get(kid) ?? 'RS256' };

  // Rotation or a new replica. Rate limited per key so a forged id cannot be used to hammer the
  // authority from here.
  const lastAttempt = lastRefetchByKid.get(kid) ?? 0;
  if (Date.now() - lastAttempt < 60_000) return null;
  lastRefetchByKid.set(kid, Date.now());
  try {
    await ensureKeySet();
  } catch {
    return null;
  }
  const found = cache?.keys.get(kid);
  return found ? { key: found, alg: cache!.algByKid.get(kid) ?? 'RS256' } : null;
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Verifies a token against THIS bank's realm.
 *
 * Every classic verification defect is refused explicitly, because each one is an accepted forgery
 * rather than a failed parse.
 */
export async function verifyRealmToken(token: string): Promise<VerifiedClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const header = decodeSegment(parts[0]);
  if (!header) return null;
  if (header.alg !== 'RS256') return null;
  // A token may not nominate the key that validates it.
  if (header.jku || header.jwk || header.x5u || header.x5c) return null;
  if (typeof header.kid !== 'string') return null;

  const resolved = await resolveKey(header.kid);
  if (!resolved || resolved.alg !== 'RS256') return null;

  const valid = cryptoVerify(
    'sha256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    resolved.key,
    Buffer.from(parts[2], 'base64url'),
  );
  if (!valid) return null;

  const claims = decodeSegment(parts[1]);
  if (!claims) return null;

  // The issuer names the REALM. A token from the platform's realm carries a different issuer and is
  // refused here even if it were somehow signed by a key this bank knows.
  if (claims.iss !== config.giam.issuerUrl) return null;

  /**
   * And the audience names who the token was FOR.
   *
   * The issuer check alone is not enough. Within one realm the authority issues tokens to many
   * clients, and a token minted for one of them verifies perfectly against the same key set. Without
   * this, any token from this realm opens this bank, which makes the realm boundary the only
   * boundary there is and turns every client into an equal.
   */
  const audience = (Array.isArray(claims.aud) ? claims.aud : [claims.aud]).map(String);
  const accepted = new Set([config.giam.audience, config.giam.resourceServerName].filter(Boolean));
  if (!audience.some((entry) => accepted.has(entry))) return null;

  const now = Math.floor(Date.now() / 1000);
  const skew = 60;
  if (typeof claims.exp === 'number' && claims.exp + skew < now) return null;
  if (typeof claims.nbf === 'number' && claims.nbf - skew > now) return null;

  return {
    ...claims,
    sub: String(claims.sub ?? ''),
    iss: String(claims.iss),
    aud: claims.aud as string | string[],
    exp: Number(claims.exp ?? 0),
    scope: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [],
    permissions: Array.isArray(claims.permissions)
      ? (claims.permissions as unknown[])
        // A v39-shaped entry is CONVERTED rather than dropped: a token minted minutes before the
        // authority upgraded is still valid, and refusing it would turn a rolling deploy into an
        // outage. It disappears on its own within one access-token lifetime.
        .map((entry) => (typeof entry === 'string'
          ? entry
          : `${(entry as { resource?: string }).resource ?? ''}:${(entry as { action?: string }).action ?? ''}`))
        .filter((entry) => entry.length > 1 && !entry.startsWith(':') && !entry.endsWith(':'))
      : [],
    roles: Array.isArray(claims.roles) ? claims.roles as string[] : [],
    clientId: typeof claims.client_id === 'string' ? claims.client_id : undefined,
    sessionId: typeof claims.sid === 'string' ? claims.sid : undefined,
  };
}

export function resetVerifierCache(): void {
  cache = null;
  jwksUri = null;
  lastRefetchByKid.clear();
}

import { createPublicKey, verify as cryptoVerify, KeyObject } from 'crypto';
import { config } from '../../config';

/**
 * Local verification against the authority's PUBLISHED keys.
 *
 * The defining property of the mode: this application holds nothing secret and asks the authority
 * nothing at verification time. It downloads a set of PUBLIC keys, caches them, and checks a
 * signature in process. A compromised resource server therefore cannot mint a token, which is not
 * true of any scheme where the verifier holds a shared secret.
 *
 * The trade is stated rather than hidden: a revoked token stays valid until it expires, because
 * nothing asks. Access-token lifetimes are short for exactly that reason, and the operations where
 * being wrong is expensive introspect instead.
 *
 * Moves to the shared client package once every consumer needs it; keeping four copies of this logic
 * is how four verifiers end up disagreeing about which defects to refuse.
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
  /**
   * The roles the authority resolved. THE DEFAULT CARRIER of authority since v40.
   *
   * Expanded against the published catalog, because a token carrying every permission a
   * subject holds is a token that fails on whichever proxy cuts around 8 KB first.
   */
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
  sessionEpoch?: number;
  /** RFC 8693 delegation chain, when the token was obtained by exchange. */
  act?: Record<string, unknown>;
  [claim: string]: unknown;
}

interface CachedKeySet {
  keys: Map<string, KeyObject>;
  algByKid: Map<string, string>;
  fetchedAt: number;
  /** The last set that was successfully fetched, kept so an outage does not fail every request. */
  stale: boolean;
}

let cache: CachedKeySet | null = null;
let jwksUri: string | null = null;
let inFlight: Promise<void> | null = null;
const lastRefetchByKid = new Map<string, number>();

/** Observability. A rising stale-serve count is the early warning that the authority is unreachable. */
export const verifierMetrics = {
  cacheHits: 0,
  refetches: 0,
  staleServes: 0,
  failuresByCause: new Map<string, number>(),
};

let lastUnreachableWarning = 0;

/** Rate limited to one a minute: this is reached per request, and a flooded log hides its own cause. */
function warnUnreachable(err: unknown): void {
  if (Date.now() - lastUnreachableWarning < 60_000) return;
  lastUnreachableWarning = Date.now();
  const reason = err instanceof Error ? err.message : 'unknown error';
  console.warn(`[giam] no key set available from ${config.giam.issuerUrl}: ${reason}`);
  console.warn('[giam] every token will be refused as unknown_kid until this resolves; check GIAM_ISSUER_URL is reachable from this process');
}

const mismatchedIssuersSeen = new Set<string>();

/** Once per distinct issuer, so a scripted probe cannot grow the log without bound. */
function warnIssuerMismatch(seen: string): void {
  if (mismatchedIssuersSeen.has(seen) || mismatchedIssuersSeen.size > 20) return;
  mismatchedIssuersSeen.add(seen);
  console.warn(`[giam] token issuer "${seen}" does not match the expected "${config.giam.issuerUrl}"`);
}

function recordFailure(cause: string): null {
  verifierMetrics.failuresByCause.set(cause, (verifierMetrics.failuresByCause.get(cause) ?? 0) + 1);
  return null;
}

/**
 * Discovery, once, then the key set.
 *
 * The key set URL is never hardcoded: a realm's issuer is configuration and the path beneath it
 * belongs to the authority, so hardcoding it would break the first time the authority reorganised
 * its own routes.
 */
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
      // A key the runtime cannot parse is skipped rather than fatal: the rest of the set is still
      // usable, and refusing everything because of one entry would be a self-inflicted outage.
    }
  }
  cache = { keys, algByKid, fetchedAt: Date.now(), stale: false };
  verifierMetrics.refetches += 1;
}

/** Shared across concurrent callers, so a burst produces one request rather than one each. */
async function ensureKeySet(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = fetchKeySet().finally(() => { inFlight = null; });
  return inFlight;
}

async function resolveKey(kid: string): Promise<{ key: KeyObject; alg: string } | null> {
  const ttl = config.giam.jwksCacheSeconds * 1000;
  const fresh = cache && Date.now() - cache.fetchedAt < ttl;

  if (!cache || !fresh) {
    try {
      await ensureKeySet();
    } catch (err) {
      // Serve from a stale cache rather than failing closed. The alternative is a total outage of
      // this application every time the authority blinks, and it is safe: an old public key can only
      // validate signatures the authority itself produced.
      if (cache) {
        cache.stale = true;
        verifierMetrics.staleServes += 1;
      } else {
        // Nothing cached and nothing fetchable means every token is about to be refused as
        // unknown_kid, which reads like a forgery. Say so once, or the cause stays invisible.
        warnUnreachable(err);
        return null;
      }
    }
  } else {
    verifierMetrics.cacheHits += 1;
  }

  const existing = cache?.keys.get(kid);
  if (existing) return { key: existing, alg: cache!.algByKid.get(kid) ?? 'RS256' };

  // An unknown key id means either a rotation or a new replica, both of which are ordinary. The
  // refetch is rate limited per key so a token carrying a forged id cannot be used to hammer the
  // authority.
  const lastAttempt = lastRefetchByKid.get(kid) ?? 0;
  if (Date.now() - lastAttempt < 60_000) return null;
  lastRefetchByKid.set(kid, Date.now());

  try {
    await ensureKeySet();
  } catch (err) {
    warnUnreachable(err);
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
 * Verifies a token and returns its claims, or null.
 *
 * Every classic verification defect is refused EXPLICITLY, because each one is an accepted forgery
 * rather than a failed parse, and a verifier that merely fails to handle them is a verifier that
 * accepts them the day a library changes a default.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return recordFailure('malformed');

  const header = decodeSegment(parts[0]);
  if (!header) return recordFailure('malformed_header');

  // `none` would make an unsigned token valid. A symmetric algorithm would let anyone holding the
  // PUBLIC key sign, and a public key is published to everyone by design.
  if (header.alg !== 'RS256') return recordFailure('unexpected_alg');
  // These four let a token nominate the key that validates it, which is a token asserting its own
  // authenticity. They are ignored, and their presence is itself grounds for refusal.
  if (header.jku || header.jwk || header.x5u || header.x5c) return recordFailure('header_key_injection');
  if (typeof header.kid !== 'string') return recordFailure('missing_kid');

  const resolved = await resolveKey(header.kid);
  if (!resolved) return recordFailure('unknown_kid');
  // The algorithm the AUTHORITY published for this key, not the one the token asked for.
  if (resolved.alg !== 'RS256') return recordFailure('alg_mismatch');

  const signatureValid = cryptoVerify(
    'sha256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    resolved.key,
    Buffer.from(parts[2], 'base64url'),
  );
  if (!signatureValid) return recordFailure('bad_signature');

  const claims = decodeSegment(parts[1]);
  if (!claims) return recordFailure('malformed_payload');

  if (claims.iss !== config.giam.issuerUrl) {
    // A signature this key set validated, from an issuer this service does not expect, is far more
    // often a misconfigured issuer URL than a forgery. Report both spellings so it is one look.
    warnIssuerMismatch(String(claims.iss));
    return recordFailure('wrong_issuer');
  }

  /**
   * The audience is the client the token was issued to, and it is CHECKED, not merely required.
   *
   * A token minted for another audience verifies cryptographically and must still be refused: that
   * is the whole property that stops one API's token opening another. Asserting only that the claim
   * is present looks like a check and is not one, which is worse than no check at all, because it
   * reads as though the property holds.
   *
   * The accepted set is this resource server's own name and the clients it serves. Both appear
   * because the authority issues a token whose audience is the CLIENT, while a resource server is
   * registered under its own name; a deployment where those differ is ordinary.
   */
  const audience = (Array.isArray(claims.aud) ? claims.aud : [claims.aud]).map(String);
  if (audience.length === 0) return recordFailure('missing_audience');

  const accepted = new Set([config.giam.audience, config.giam.resourceServerName].filter(Boolean));
  if (!audience.some((entry) => accepted.has(entry))) return recordFailure('wrong_audience');

  const now = Math.floor(Date.now() / 1000);
  const skew = 60;
  if (typeof claims.exp === 'number' && claims.exp + skew < now) return recordFailure('expired');
  if (typeof claims.nbf === 'number' && claims.nbf - skew > now) return recordFailure('not_yet_valid');

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
    roles: Array.isArray(claims.roles) ? (claims.roles as string[]) : [],
    clientId: typeof claims.client_id === 'string' ? claims.client_id : undefined,
    sessionId: typeof claims.sid === 'string' ? claims.sid : undefined,
    sessionEpoch: typeof claims.session_epoch === 'number' ? claims.session_epoch : undefined,
    act: claims.act as Record<string, unknown> | undefined,
  };
}

/** Test and diagnostic support: forget what was cached so the next call rediscovers. */
export function resetVerifierCache(): void {
  cache = null;
  jwksUri = null;
  lastRefetchByKid.clear();
}

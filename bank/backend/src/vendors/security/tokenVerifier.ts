import { createPublicKey, verify as cryptoVerify, KeyObject } from 'crypto';
import { discoverAuthority, fetchAuthorityJson, AuthorityDiscovery } from '@leafypay/giam-client';
import { config } from '../../config';
import { expandRoles } from './roleCatalog';

/**
 * Local verification against the authority's published keys. Same mechanics as any resource server.
 *
 * WHAT SEPARATES THIS BANK FROM THE PAYMENT SERVICE, stated exactly, because it changed and the
 * previous version of this comment now describes a protection that no longer exists.
 *
 * It used to be the KEY MATERIAL: the bank had its own realm, so a token minted for the payment
 * service was signed by a different key under a different issuer and failed the signature check
 * outright. ADR-003 merged the two into one realm, so both are now signed by the same key and carry
 * the same issuer, and that check no longer distinguishes them.
 *
 * The separation is the AUDIENCE and the RESOURCE SERVER instead. A token minted for the payment
 * service names `leafypay` in `aud` and this bank requires its own audience, so it is refused after
 * the signature rather than at it. Bank permissions are declared on the bank's own resource server,
 * so a role naming them grants nothing on the payment service and the reverse holds.
 *
 * That is weaker in one respect and it is worth being plain about: a shared signing key means the
 * authority could mint a bank-audience token, where before it could not. It is the correct trade
 * for a group running one identity provider, and the thing to revisit if the bank ever has to be a
 * separate trust boundary in earnest.
 *
 * Before ANY of this, the bank verified a payment-service-issued token with a shared symmetric
 * secret, so a token minted anywhere on the platform opened part of the banking API.
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
let discovered: AuthorityDiscovery | null = null;
let inFlight: Promise<void> | null = null;
const lastRefetchByKid = new Map<string, number>();

let lastUnreachableWarning = 0;

/** Rate limited to one a minute: this is reached per request, and a flooded log hides its own cause. */
function warnUnreachable(err: unknown): void {
  if (Date.now() - lastUnreachableWarning < 60_000) return;
  lastUnreachableWarning = Date.now();
  const reason = err instanceof Error ? err.message : 'unknown error';
  console.warn(`[giam] no key set available: ${reason}`);
  console.warn(`[giam] calling=${config.giam.issuerUrl} advertisedIssuer=${discovered?.issuer ?? 'not discovered yet'} jwks_uri=${discovered?.jwksUri ?? 'not discovered yet'}. Every token is refused as unknown_kid until the key set loads. The address in GIAM_ISSUER_URL must be reachable from this process; the issuer a token carries is learned from it.`);
}

const lastRefusalLog = new Map<string, number>();

/** One line per cause a minute, so a refused token names its reason without flooding the log. */
function refuse(cause: string, detail: Record<string, unknown> = {}): null {
  if (Date.now() - (lastRefusalLog.get(cause) ?? 0) >= 60_000) {
    lastRefusalLog.set(cause, Date.now());
    const fields = Object.entries(detail).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' ');
    console.warn(`[giam] token refused (${cause}) ${fields}`.trimEnd());
  }
  return null;
}

async function discover(): Promise<AuthorityDiscovery> {
  if (!discovered) discovered = await discoverAuthority(config.giam.issuerUrl);
  return discovered;
}

async function fetchKeySet(): Promise<void> {
  const { jwksUri } = await discover();
  const document = await fetchAuthorityJson<{ keys?: Array<Record<string, unknown>> }>(jwksUri, 'key set');

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
    } catch (err) {
      // A stale set is safe and an unreachable authority must not close the bank: an old public key
      // validates only what the authority itself signed.
      if (!cache) {
        warnUnreachable(err);
        return null;
      }
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
 * Verifies a token against THIS bank's realm.
 *
 * Every classic verification defect is refused explicitly, because each one is an accepted forgery
 * rather than a failed parse.
 */
export async function verifyRealmToken(token: string): Promise<VerifiedClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return refuse('malformed');

  const header = decodeSegment(parts[0]);
  if (!header) return refuse('malformed_header');
  if (header.alg !== 'RS256') return refuse('unexpected_alg', { alg: header.alg });
  // A token may not nominate the key that validates it.
  if (header.jku || header.jwk || header.x5u || header.x5c) return refuse('header_key_injection');
  if (typeof header.kid !== 'string') return refuse('missing_kid');

  const resolved = await resolveKey(header.kid);
  if (!resolved) return refuse('unknown_kid', { kid: header.kid, knownKids: cache ? [...cache.keys.keys()] : 'key set not loaded' });
  if (resolved.alg !== 'RS256') return refuse('alg_mismatch', { kid: header.kid, published: resolved.alg });

  const valid = cryptoVerify(
    'sha256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    resolved.key,
    Buffer.from(parts[2], 'base64url'),
  );
  if (!valid) return refuse('bad_signature', { kid: header.kid });

  const claims = decodeSegment(parts[1]);
  if (!claims) return refuse('malformed_payload');

  // The issuer names the REALM. A token from the platform's realm carries a different issuer and is
  // refused here even if it were somehow signed by a key this bank knows.
  if (claims.iss !== discovered?.issuer) {
    return refuse('wrong_issuer', { tokenIssuer: claims.iss, expected: discovered?.issuer, calling: config.giam.issuerUrl, clientId: claims.client_id });
  }

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
  if (!audience.some((entry) => accepted.has(entry))) {
    return refuse('wrong_audience', { aud: audience, accepted: [...accepted], clientId: claims.client_id });
  }

  const now = Math.floor(Date.now() / 1000);
  const skew = 60;
  if (typeof claims.exp === 'number' && claims.exp + skew < now) return refuse('expired', { exp: claims.exp, now, clientId: claims.client_id });
  if (typeof claims.nbf === 'number' && claims.nbf - skew > now) return refuse('not_yet_valid', { nbf: claims.nbf, now });

  const roles = Array.isArray(claims.roles) ? claims.roles as string[] : [];
  /**
   * `entitlements`, the RFC 9068 2.2.3.1 name that GIAM emits since v41 P1.
   *
   * Reading `permissions` here would yield an empty list without failing anything, so a token the
   * client deliberately NARROWED would expand from its roles instead: wider than was asked for, and
   * silent. That is the worst shape a break of this kind can take.
   */
  const explicit = Array.isArray(claims.entitlements) ? claims.entitlements as string[] : [];
  const expanded = await expandRoles(token, roles, explicit);

  return {
    ...claims,
    sub: String(claims.sub ?? ''),
    iss: String(claims.iss),
    aud: claims.aud as string | string[],
    exp: Number(claims.exp ?? 0),
    scope: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [],
    permissions: Array.isArray(claims.entitlements)
      ? (claims.entitlements as unknown[])
        // A v39-shaped entry is CONVERTED rather than dropped: a token minted minutes before the
        // authority upgraded is still valid, and refusing it would turn a rolling deploy into an
        // outage. It disappears on its own within one access-token lifetime.
        .map((entry) => (typeof entry === 'string'
          ? entry
          : `${(entry as { resource?: string }).resource ?? ''}:${(entry as { action?: string }).action ?? ''}`))
        .filter((entry) => entry.length > 1 && !entry.startsWith(':') && !entry.endsWith(':'))
      : [],
    roles,
    /**
     * The roles, expanded into the permissions this bank enforces.
     *
     * Set HERE because this is the one edge every guard reads through, staff and third party alike.
     * Without it the guards resolved the explicit `permissions` claim, which an ordinary token has
     * not carried since v40, so every guarded route refused every caller including a bank
     * administrator. It failed closed, and it failed completely.
     *
     * Absent when the catalog has never resolved, which the guards treat as "fall back to the
     * explicit claim" and therefore still deny.
     */
    ...(expanded ? { effectivePermissions: expanded } : {}),
    clientId: typeof claims.client_id === 'string' ? claims.client_id : undefined,
    sessionId: typeof claims.sid === 'string' ? claims.sid : undefined,
  };
}

export function resetVerifierCache(): void {
  cache = null;
  discovered = null;
  lastRefetchByKid.clear();
}

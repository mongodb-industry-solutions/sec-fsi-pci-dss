import { config } from '../../config';

/**
 * Expanding a token's ROLES into the permissions this application enforces.
 *
 * Since v40 an access token carries roles and not permissions, because a token holding every
 * permission a subject has is a token that fails on whichever proxy is strictest. The consequence
 * is that a resource server has to expand them, and this is where that happens.
 *
 * THE DEFECT THIS FIXES. `requirePermission` read `effectivePermissions` off the verified claims,
 * that field was declared and never assigned, and the fallback was the explicit `permissions`
 * claim, which is absent on an ordinary token. So the guard resolved an empty set and refused
 * EVERY caller on EVERY guarded route, including a realm administrator. It failed closed, which is
 * the right direction to fail, and it failed completely.
 *
 * The catalog is fetched with the CALLER's already-verified bearer, and that is not circular.
 * Verification and authorisation are separate steps: the signature, the issuer and the expiry are
 * checked before this runs and none of them consults the catalog. All the catalog adds is what the
 * token's role NAMES mean, so a verified caller asking the authority to expand its own roles is
 * asking a question it is entitled to ask.
 *
 * The alternative, this service's own client credential, was tried first and rejected: it makes
 * permission enforcement depend on a secret being configured, so a deployment missing one refuses
 * every request on every guarded route rather than degrading.
 *
 * What is cached is realm-wide and not caller-specific, so one caller's fetch legitimately serves
 * the next. Nothing here is an access decision: whether the expansion permits the request is still
 * decided by `hasPermission` against the claims.
 */

export interface RoleCatalog {
  catalogVersion: number;
  roles: Array<{ name: string; permissions: string[] }>;
}

const CATALOG_TTL_MS = 60_000;

let catalog: RoleCatalog | null = null;
let catalogFetchedAt = 0;

function issuer(): string {
  return config.giam.issuerUrl.replace(/\/+$/, '');
}

/**
 * The published role catalog, refreshed when stale.
 *
 * Never throws, and on failure serves the LAST GOOD copy rather than nothing. An authority that
 * blinks must not revoke everybody's authority for the duration: the previous answer is what the
 * authority itself last said, and role definitions do not change on the timescale of an outage.
 * Null only before the first successful fetch, and null denies.
 */
export async function roleCatalog(bearer: string): Promise<RoleCatalog | null> {
  if (catalog && Date.now() - catalogFetchedAt < CATALOG_TTL_MS) return catalog;
  if (!bearer) return catalog;

  try {
    const response = await fetch(`${issuer()}/permissions`, {
      headers: { authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return catalog;

    const body = await response.json() as RoleCatalog;
    if (!Array.isArray(body?.roles)) return catalog;

    catalog = { catalogVersion: Number(body.catalogVersion ?? 0), roles: body.roles };
    catalogFetchedAt = Date.now();
    return catalog;
  } catch {
    return catalog;
  }
}

/**
 * What a caller may actually do: the permissions carried explicitly, plus what their roles expand to.
 *
 * A UNION rather than one or the other, because a token may legitimately carry both. A client that
 * narrowed its request still holds its roles, so a resource server enforcing roles keeps working
 * and narrowing cannot accidentally widen.
 *
 * Returns null when the catalog has never resolved, which is deliberately distinguishable from an
 * empty set: the caller leaves `effectivePermissions` unset so the guard falls back to explicit
 * claims, instead of recording "this principal holds nothing" as though it had been resolved.
 */
export async function expandRoles(
  bearer: string,
  roles: ReadonlyArray<string>,
  explicit: ReadonlyArray<string> = [],
): Promise<string[] | null> {
  const resolved = await roleCatalog(bearer);
  if (!resolved) return null;

  const held = new Set<string>(explicit);
  const byName = new Map(resolved.roles.map((role) => [role.name, role.permissions]));
  for (const role of roles) {
    for (const permission of byName.get(role) ?? []) held.add(permission);
  }
  return [...held];
}

/** For a test, and for an operator forcing a refresh after a catalog deploy. */
export function invalidateRoleCatalog(): void {
  catalog = null;
  catalogFetchedAt = 0;
}

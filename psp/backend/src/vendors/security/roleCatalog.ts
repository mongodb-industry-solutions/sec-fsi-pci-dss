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
  // Each declared enforcement point, tagged with the resource server that owns it. This is what
  // makes `ownRoleNames` below correct where matching by bare resource NAME is not: "accounts" is
  // declared by both leafypay and bankcore, meaning what an account is at each, and a role holding
  // `accounts:view` could be either one's.
  permissions: Array<{ permission: string; resourceServer: string }>;
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

    catalog = {
      catalogVersion: Number(body.catalogVersion ?? 0),
      roles: body.roles,
      permissions: Array.isArray(body.permissions) ? body.permissions : [],
    };
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

/**
 * Which of a token's roles are this application's OWN, in the order the authority sent them.
 *
 * A principal can hold roles at more than one resource server on the SAME token (an account holder
 * of the payment provider who is also an account holder at the bank), and the realm's published
 * catalog is realm-wide, not scoped per resource server: `bank_customer` is right there beside
 * `customer` in the same `roles` array. Code that still reasons about "the role" in the singular
 * (see `roleOf` in vendors/middleware/auth.ts) took index 0 unconditionally, which used to be safe
 * because a token only ever carried one role, and stopped being safe the moment it could carry two:
 * `["bank_customer", "customer"]` picked the bank's role for an ordinary LeafyPay request and
 * refused a customer their own beneficiaries as a stranger asking to investigate someone else's.
 *
 * A single shared permission is not enough to call a role "ours", and that qualifier is not
 * decoration: `accounts` is declared by both leafypay and bankcore, meaning something different at
 * each, so `accounts:view` is a string both catalogs happen to use and matching on ANY overlap
 * would let `bank_customer` back in for holding that one shared permission alongside three
 * (`accountHolders:view`, `movements:view`, `issuedCards:view`) that mean nothing here.
 *
 * So the question is comparative: of the permissions a role holds AT A RESOURCE SERVER, do more of
 * them belong to this one than to any other? `customer` clears it because all of its permissions
 * are leafypay's, and `bank_customer` fails it at one shared string against three of bankcore's.
 *
 * THE DEFECT THIS FIXES. The comparison used to be against the role's WHOLE permission list, and
 * that list also contains the authority's own realm-administration permissions, which belong to no
 * resource server's vocabulary. `manager` holds four of leafypay's (`providers:manage`,
 * `providers:view`, `auditEvents:view`, `modules:view`) and twenty-nine of the authority's, so a
 * majority of thirty-three was unreachable and the platform administrator resolved as holding no
 * role here at all: `roleOf` returned undefined, `extractUserRole` fell back to its default, and
 * every provider and routing-group route refused the one role that administers them. The
 * authority's permissions are excluded from the comparison rather than counted against us: they
 * say what a principal may do AT THE AUTHORITY, which tells us nothing about whose role this is.
 *
 * A role neither this catalog nor this application recognises is filtered out too, which is the
 * same default-deny direction as everywhere else here: an unrecognised name grants nothing rather
 * than being guessed at.
 */
export function ownRoleNames(resolved: RoleCatalog, roles: ReadonlyArray<string>): string[] {
  const ownPermissions = new Set<string>();
  const resourceServerPermissions = new Set<string>();
  for (const entry of resolved.permissions) {
    if (entry.resourceServer === config.giam.resourceServerName) ownPermissions.add(entry.permission);
    // The authority is the realm itself, not a peer resource server, so its enforcement points are
    // not evidence of a role belonging elsewhere.
    if (entry.resourceServer !== config.giam.authorityResourceServerName) {
      resourceServerPermissions.add(entry.permission);
    }
  }

  const permissionsByRole = new Map(resolved.roles.map((role) => [role.name, role.permissions]));
  return roles.filter((name) => {
    const permissions = permissionsByRole.get(name);
    if (!permissions || permissions.length === 0) return false;
    const ours = permissions.filter((permission) => ownPermissions.has(permission)).length;
    if (ours === 0) return false;
    // Held at another resource server and not here: the evidence against the role being ours.
    const foreign = permissions.filter(
      (permission) => resourceServerPermissions.has(permission) && !ownPermissions.has(permission),
    ).length;
    return ours > foreign;
  });
}

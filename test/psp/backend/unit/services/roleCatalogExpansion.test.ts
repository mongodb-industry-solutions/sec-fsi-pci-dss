/**
 * Expanding a token's roles into the permissions this application enforces.
 *
 * This suite exists because of a total, silent authorisation outage. `requirePermission` read
 * `effectivePermissions` off the verified claims; that field was declared and never assigned; the
 * fallback was the explicit `permissions` claim, which v40 made absent on an ordinary token. So the
 * guard resolved an EMPTY SET and refused every caller on every guarded route, a realm
 * administrator included.
 *
 * It failed closed, which is the right direction, and it failed completely. Nothing caught it
 * because no test ever presented a role-only token to a guarded route, so the invariants are pinned
 * here: what expansion produces, and what it does when it cannot resolve.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { expandRoles, roleCatalog, invalidateRoleCatalog } from '../../../../../psp/backend/src/vendors/security/roleCatalog';

const CATALOG = {
  catalogVersion: 1,
  roles: [
    { name: 'level1_analyst', permissions: ['transactions:view', 'customers:view'] },
    { name: 'manager', permissions: ['modules:view', 'auditEvents:view'] },
  ],
};

function respondWith(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  invalidateRoleCatalog();
});

afterEach(() => {
  vi.unstubAllGlobals();
  invalidateRoleCatalog();
});

describe('expanding roles against the published catalog', () => {
  it('turns a role into the permissions it grants', async () => {
    vi.stubGlobal('fetch', respondWith(CATALOG));

    const held = await expandRoles('caller-token', ['level1_analyst']);

    // The exact failure that broke every guarded route: this used to resolve to nothing.
    expect(held).not.toBeNull();
    expect(held).toEqual(expect.arrayContaining(['transactions:view', 'customers:view']));
  });

  it('unions several roles, and adds explicitly carried permissions', async () => {
    /**
     * A union rather than one or the other.
     *
     * A client that narrowed its request still holds its roles, so a resource server enforcing
     * roles keeps working. Intersecting here would let narrowing silently remove authority the
     * caller still has, and preferring the explicit claim alone would ignore the roles entirely.
     */
    vi.stubGlobal('fetch', respondWith(CATALOG));

    const held = await expandRoles('caller-token', ['level1_analyst', 'manager'], ['cards:view']);

    expect(new Set(held)).toEqual(new Set([
      'transactions:view', 'customers:view', 'modules:view', 'auditEvents:view', 'cards:view',
    ]));
  });

  it('ignores a role the catalog does not describe, rather than guessing', async () => {
    vi.stubGlobal('fetch', respondWith(CATALOG));
    const held = await expandRoles('caller-token', ['a_role_nobody_registered']);
    expect(held).toEqual([]);
  });

  it('returns NULL when the catalog has never resolved, which is not the same as empty', async () => {
    /**
     * The distinction the guard depends on.
     *
     * Null means "not resolved", so the caller leaves `effectivePermissions` unset and the guard
     * falls back to the explicit claims. An empty array would record "this principal holds
     * nothing" as though it had been resolved, which is a different and untrue statement, and it
     * would mask exactly the outage this file is about.
     */
    vi.stubGlobal('fetch', respondWith({ error: 'nope' }, false, 503));
    expect(await expandRoles('caller-token', ['manager'])).toBeNull();
  });

  it('serves the last good catalog when the authority stops answering', async () => {
    /**
     * An authority that blinks must not revoke everybody's authority for the duration.
     *
     * The previous answer is what the authority itself last said, and role definitions do not
     * change on the timescale of an outage. Refusing instead would turn a brief upstream failure
     * into a platform-wide loss of access.
     */
    vi.stubGlobal('fetch', respondWith(CATALOG));
    expect(await roleCatalog('caller-token')).toEqual(CATALOG);

    invalidateCatalogTtlOnly();
    vi.stubGlobal('fetch', respondWith(null, false, 500));

    expect(await roleCatalog('caller-token'), 'an outage discarded the cached catalog').toEqual(CATALOG);
  });

  it('never throws when the authority is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    await expect(expandRoles('caller-token', ['manager'])).resolves.toBeNull();
  });

  it('does not call the authority without a bearer to present', async () => {
    // Nothing to authenticate with is not a reason to make the request and be refused.
    const spy = respondWith(CATALOG);
    vi.stubGlobal('fetch', spy);
    expect(await expandRoles('', ['manager'])).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

/**
 * Expires the TTL without discarding the cached copy.
 *
 * `invalidateRoleCatalog` drops the copy as well, which is right for an operator forcing a refresh
 * and wrong for asserting the stale-serve path, so the clock is moved instead of the cache cleared.
 */
function invalidateCatalogTtlOnly(): void {
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
}

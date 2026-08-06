/**
 * Unit tests: data-driven RBAC/ACL (ADR-030, plan §13).
 * Validates the builtin permission matrix (PCI DSS least-privilege + SoD), the default-deny
 * `can()` resolution (DB-backed with builtin fallback) and the `requirePermission` guard.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BUILTIN_ROLES, hasPermission, RolePermissions,
} from '../../../../backend/src/shared/models/acl.model';
import { can, requirePermission, invalidateRoleCache, loadRole } from '../../../../backend/src/vendors/middleware/acl';

const byName = (n: string) => BUILTIN_ROLES.find((r) => r.roleName === n)!;

// Minimal Db mock: collection().findOne() returns whatever role doc we stage (or null).
function mockDb(roleDoc: unknown) {
  return { collection: () => ({ findOne: async () => roleDoc }) } as never;
}

describe('ACL builtin matrix (PCI Req 7)', () => {
  it('manager has NO access to business/cardholder data (SoD)', () => {
    const m: RolePermissions = byName('manager').rolePermissions;
    for (const res of ['transactions', 'customers', 'cards', 'fraudCases'] as const) {
      expect(hasPermission(m, res, 'view')).toBe(false);
      expect(hasPermission(m, res, 'viewSensitive')).toBe(false);
    }
    // …but does administer the platform
    expect(hasPermission(m, 'providers', 'manage')).toBe(true);
    expect(hasPermission(m, 'roles', 'manage')).toBe(true);
  });

  it('analyst can view transactions and investigate cases, but not sensitive fields', () => {
    const l1 = byName('level1_analyst').rolePermissions;
    expect(hasPermission(l1, 'transactions', 'view')).toBe(true);
    expect(hasPermission(l1, 'fraudCases', 'investigate')).toBe(true);
    expect(hasPermission(l1, 'transactions', 'viewSensitive')).toBe(false);
  });

  it('L2 adds viewSensitive; auditor is read-only global', () => {
    expect(hasPermission(byName('level2_investigator').rolePermissions, 'customers', 'viewSensitive')).toBe(true);
    const aud = byName('security_auditor').rolePermissions;
    expect(hasPermission(aud, 'transactions', 'viewSensitive')).toBe(true);
    expect(hasPermission(aud, 'transactions', 'manage')).toBe(false); // read-only
  });

  it('default-deny: unlisted resource/action is denied', () => {
    expect(hasPermission(byName('customer').rolePermissions, 'fraudCases', 'view')).toBe(false);
    expect(hasPermission(undefined, 'transactions', 'view')).toBe(false);
  });

  it('all builtin roles are present and marked builtin', () => {
    const names = BUILTIN_ROLES.map((r) => r.roleName).sort();
    expect(names).toEqual(['customer', 'level1_analyst', 'level2_investigator', 'manager', 'merchant_officer', 'operations_officer', 'security_auditor']);
    expect(BUILTIN_ROLES.every((r) => r.roleIsBuiltin)).toBe(true);
  });
});

describe('can() resolution', () => {
  beforeEach(() => invalidateRoleCache());

  it('reads permissions from the DB when present', async () => {
    const db = mockDb({ roleName: 'manager', rolePermissions: { transactions: ['view'] } });
    expect(await can(db, 'manager', 'transactions', 'view')).toBe(true); // DB doc overrides builtin
  });

  it('falls back to the builtin matrix when the DB has no row', async () => {
    const db = mockDb(null);
    expect(await can(db, 'manager', 'transactions', 'view')).toBe(false);
    expect(await can(db, 'level1_analyst', 'transactions', 'view')).toBe(true);
  });

  it('unknown role resolves to no permissions', async () => {
    const db = mockDb(null);
    expect(await loadRole(db, 'ghost')).toBeNull();
    expect(await can(db, 'ghost', 'transactions', 'view')).toBe(false);
  });
});

describe('requirePermission guard', () => {
  beforeEach(() => invalidateRoleCache());

  function mockReqReply(role: string) {
    const reply = {
      statusCode: 0,
      body: null as unknown,
      status(c: number) { this.statusCode = c; return this; },
      send(b: unknown) { this.body = b; return this; },
    };
    const request = { server: { db: mockDb(null) }, userRole: role } as never;
    return { request, reply };
  }

  it('denies manager on transactions:view with 403 ACL_DENIED', async () => {
    const guard = requirePermission('transactions', 'view');
    const { request, reply } = mockReqReply('manager');
    await guard(request, reply as never);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as { code: string }).code).toBe('ACL_DENIED');
  });

  it('allows analyst on transactions:view (no reply sent)', async () => {
    const guard = requirePermission('transactions', 'view');
    const { request, reply } = mockReqReply('level1_analyst');
    await guard(request, reply as never);
    expect(reply.statusCode).toBe(0); // guard did not respond → request proceeds
  });
});

import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import {
  ROLE_COLLECTION, RoleRecord, RolePermissions, Resource, Action,
  BUILTIN_ROLES, hasPermission,
} from '../../shared/models/acl.model';
import type { AuthenticatedRequest } from '../../shared/models/identity.model';
import { canReadSensitive } from './rbac';

// ── Role-permission cache ─────────────────────────────────────────────────────
// Permissions are DATA (the `role` collection), editable at runtime. We cache per role with a
// short TTL and explicit invalidation on edits, so a permission change takes effect without a
// re-login (the JWT never carries permissions: see /acl/effective). Default-deny throughout.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { role: RoleRecord | null; expires: number }>();

const BUILTIN_BY_NAME = new Map(BUILTIN_ROLES.map((r) => [r.roleName, r]));

function builtinFallback(roleName: string): RoleRecord | null {
  const b = BUILTIN_BY_NAME.get(roleName);
  if (!b) return null;
  return { ...b, recordCreatedDateTime: new Date(0), recordUpdatedDateTime: new Date(0) };
}

export function invalidateRoleCache(roleName?: string): void {
  if (roleName) cache.delete(roleName);
  else cache.clear();
}

// Resolve a role record from the DB; fall back to the builtin matrix if the collection is
// unavailable or the role is a not-yet-seeded builtin. Never throws: enforcement must not fail open.
//
// For builtin roles loaded from DB: any resource present in the in-code builtin but absent from the
// DB record is merged in. This means new resources (e.g. 'beneficiaries' in v18) take effect without
// requiring a manual re-seed, only additions are merged, so manager permission edits are preserved.
export async function loadRole(db: Db, roleName: string | undefined): Promise<RoleRecord | null> {
  if (!roleName) return null;
  const cached = cache.get(roleName);
  const now = Date.now();
  if (cached && cached.expires > now) return cached.role;

  let role: RoleRecord | null = null;
  try {
    role = await db.collection<RoleRecord>(ROLE_COLLECTION).findOne({ roleName });
  } catch {
    role = null;
  }
  if (!role) {
    role = builtinFallback(roleName);
  } else if (role.roleIsBuiltin) {
    // Merge any missing resources from the in-code builtin into the DB record so new resources
    // added to code propagate immediately without a re-seed.
    const builtin = BUILTIN_BY_NAME.get(roleName);
    if (builtin) {
      const merged: RolePermissions = { ...role.rolePermissions };
      let patched = false;
      for (const [res, actions] of Object.entries(builtin.rolePermissions) as [Resource, Action[]][]) {
        if (!merged[res]) {
          merged[res] = actions;
          patched = true;
        }
      }
      if (patched) role = { ...role, rolePermissions: merged };
    }
  }
  cache.set(roleName, { role, expires: now + CACHE_TTL_MS });
  return role;
}

export async function loadRolePermissions(db: Db, roleName: string | undefined): Promise<RolePermissions | undefined> {
  return (await loadRole(db, roleName))?.rolePermissions;
}

export async function can(db: Db, roleName: string | undefined, resource: Resource, action: Action): Promise<boolean> {
  return hasPermission(await loadRolePermissions(db, roleName), resource, action);
}

function serverDb(request: FastifyRequest): Db {
  return (request.server as FastifyInstance & { db: Db }).db;
}

function roleOf(request: FastifyRequest): string | undefined {
  return (request as unknown as AuthenticatedRequest).userRole
    ?? (request as FastifyRequest & { user?: { role?: string } }).user?.role;
}

/**
 * Generic, data-driven authorization guard (PCI DSS, default-deny). Use as a route
 * preHandler: `preHandler: requirePermission('transactions', 'view')`. Denies with 403 + a
 * machine-readable body the frontend maps to <AccessDenied>.
 *
 * `viewSensitive` additionally requires the escalation flow (canReadSensitive) on top of the
 * role granting the permission, so an L2 still needs a valid escalation token, while an auditor
 * (direct sensitive reader) passes. Plain `view`/`manage`/`investigate` are pure ACL checks.
 */
export function requirePermission(resource: Resource, action: Action) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = roleOf(request);
    const allowed = await can(serverDb(request), role, resource, action);
    if (!allowed) {
      return reply.status(403).send({
        error: `Access denied: your role does not permit ${action} on ${resource}.`,
        code: 'ACL_DENIED',
        resource,
        action,
        role: role ?? null,
      });
    }
    if (action === 'viewSensitive') {
      const escToken = (request as unknown as AuthenticatedRequest).escalationToken;
      if (role && !canReadSensitive(role as never, !!escToken)) {
        return reply.status(403).send({
          error: 'Access denied: sensitive access requires an active escalation token.',
          code: 'ESCALATION_REQUIRED',
          resource,
          action,
          role,
        });
      }
    }
  };
}

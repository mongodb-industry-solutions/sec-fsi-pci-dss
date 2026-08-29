import { FastifyRequest, FastifyReply } from 'fastify';
import { Resource, Action, hasPermission } from '../../shared/models/permissionCatalog';
import type { AuthenticatedRequest } from '../../shared/models/identity.model';
import { canReadSensitive } from './rbac';

/**
 * The authorization guard, reading a claim.
 *
 * v39 P6.4: this used to load a role from a collection this application owned, merge it with an
 * in-code fallback matrix, and cache the result for thirty seconds per process. All of that is gone
 * along with the collection it read.
 *
 * What replaced it is smaller and stricter: the authority resolves a principal's permissions at
 * issuance and writes them into the token, so the check is a claim read. No lookup, no cache, no
 * fallback matrix. Removing the cache removes a real defect as well as code: a thirty-second
 * per-process cache meant a permission change took up to thirty seconds to apply, and took a
 * different amount of time on each replica.
 *
 * The trade is stated rather than hidden. A permission change now reaches a live token only when the
 * next one is issued, which is a longer window than thirty seconds. Access tokens are short-lived for
 * that reason, and the operations where being wrong is expensive ask the authority directly instead
 * of trusting the claim.
 */

/** Permissions the authority resolved, or an empty list. Default deny: absent is not unrestricted. */
function permissionsOf(request: FastifyRequest): Array<{ resource: string; action: string }> {
  const user = (request as FastifyRequest & {
    user?: { permissions?: Array<{ resource: string; action: string }> };
  }).user;
  return user?.permissions ?? [];
}

function roleOf(request: FastifyRequest): string | undefined {
  const user = (request as FastifyRequest & { user?: { roles?: string[] } }).user;
  return (request as unknown as AuthenticatedRequest).userRole ?? user?.roles?.[0];
}

export function can(request: FastifyRequest, resource: Resource, action: Action): boolean {
  return hasPermission(permissionsOf(request), resource, action);
}

/**
 * Route guard. Default deny, and the refusal is machine-readable so the interface can render it.
 *
 * `viewSensitive` additionally requires the elevation on top of the permission, so holding the role
 * is not the same as exercising it: an investigator still needs an approved elevation, while an
 * auditor whose whole role is sensitive read-only oversight passes on the permission alone.
 */
export function requirePermission(resource: Resource, action: Action) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = roleOf(request);

    if (!can(request, resource, action)) {
      return reply.status(403).send({
        error: `Access denied: your role does not permit ${action} on ${resource}.`,
        code: 'ACL_DENIED',
        resource,
        action,
        role: role ?? null,
      });
    }

    if (action === 'viewSensitive') {
      const elevation = (request as unknown as AuthenticatedRequest).elevation;
      if (role && !canReadSensitive(role as never, Boolean(elevation))) {
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

/**
 * Kept as a no-op so the call sites that invalidated the old cache still compile.
 *
 * There is no cache to invalidate: permissions travel in the token. The function goes with the last
 * of those call sites in the deletion pass, and leaving it as a silent no-op until then is better
 * than leaving code that clears a map nothing reads.
 */
export function invalidateRoleCache(): void {
  // Intentionally empty. See above.
}

// Shared dual-auth resolver (v23): one capability endpoint, two authentication channels.
//
// A capability route (e.g. /beneficiaries, /accounts) is consumed by BOTH:
//   · first-party callers  → PSP session JWT (HS256) + RBAC (requirePermission semantics)
//   · third-party merchant → OAuth2 on-behalf-of Bearer (RS256) + scope + subject binding
// Auth is a cross-cutting concern, NOT a reason to fork the API into a /merchant/* surface.
//
// Authentication happens in the global authMiddleware (routes flagged `config: { dualAuth: true }`):
//   · a valid session JWT populates request.user (+ RBAC context via attachRbacContext)
//   · otherwise a valid OAuth Bearer populates request.merchantContext (scope NOT yet enforced)
// This module only AUTHORIZES: dualPermission() enforces the RBAC action (session) OR the OAuth
// scope (merchant), and resolveOwner() yields the owner the operation acts on.

import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import type { Resource, Action } from '../../shared/models/acl.model';
import type { JwtUserPayload, AuthenticatedRequest } from '../../shared/models/identity.model';
import { can } from './acl';
import { resolvePartyInstanceReference } from '../../modules/identity/services/oauth.service';

export type AuthChannel = 'session' | 'oauth';

export interface DualPermissionOptions {
  // First-party RBAC requirement (session channel).
  resource: Resource;
  action: Action;
  // OAuth scope requirement (merchant on-behalf-of channel).
  scope: string;
}

function serverDb(request: FastifyRequest): Db {
  return (request.server as FastifyInstance & { db: Db }).db;
}

function sessionRole(request: FastifyRequest): string | undefined {
  return (request as unknown as AuthenticatedRequest).userRole
    ?? (request as FastifyRequest & { user?: { role?: string } }).user?.role;
}

/**
 * preHandler: authorize a dual-auth capability route.
 *  · OAuth channel (request.merchantContext present): require the route's scope (403 otherwise).
 *  · Session channel: enforce the RBAC action via can(), identical to requirePermission('view'/'manage').
 * Separation of duties: an OAuth token is never granted staff RBAC, and a session is never scope-gated.
 */
export function dualPermission(opts: DualPermissionOptions) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const merchant = request.merchantContext;
    if (merchant) {
      if (!merchant.scopes.includes(opts.scope)) {
        return reply.status(403).send({
          error: 'insufficient_scope',
          error_description: `Required scope: ${opts.scope}`,
        });
      }
      return;
    }
    const role = sessionRole(request);
    const allowed = await can(serverDb(request), role, opts.resource, opts.action);
    if (!allowed) {
      return reply.status(403).send({
        error: `Access denied: your role does not permit ${opts.action} on ${opts.resource}.`,
        code: 'ACL_DENIED',
        resource: opts.resource,
        action: opts.action,
        role: role ?? null,
      });
    }
  };
}

export interface ResolvedOwner {
  channel: AuthChannel;
  // party the domain data is keyed by. Undefined only when an OAuth subject has no linked
  // party (caller should return an empty result, never a cross-user leak).
  ownerPartyRef?: string;
  // The authenticated subject: OAuth token.sub, or the session partyRef.
  actingSubject?: string;
}

/**
 * Resolve the owner a dual-auth operation acts on, enforcing subject binding.
 *
 * OAuth channel: owner = resolveParty(token.sub). `pathOwnerRef`, when present, MUST equal token.sub
 *   (the merchant may not target another user); a mismatch replies 403 and returns null.
 * Session channel: staff may target any `pathOwnerRef`; a `customer` role is bound to its own partyRef
 *   (mismatch replies 403). `pathOwnerRef` is required for the session channel (replies 400 if absent).
 *
 * Returns null when a reply has already been sent (caller must stop).
 */
export async function resolveOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  pathOwnerRef?: string,
): Promise<ResolvedOwner | null> {
  const merchant = request.merchantContext;
  if (merchant) {
    if (pathOwnerRef && pathOwnerRef !== merchant.sub) {
      reply.status(403).send({
        error: 'access_denied',
        error_description: 'Token subject does not match the requested owner. Use authorization_code on behalf of this user.',
      });
      return null;
    }
    const ownerPartyRef = (await resolvePartyInstanceReference(serverDb(request), merchant.sub)) ?? undefined;
    return { channel: 'oauth', ownerPartyRef, actingSubject: merchant.sub };
  }

  const user = (request as FastifyRequest & { user?: JwtUserPayload }).user;
  if (!pathOwnerRef) {
    reply.status(400).send({ error: 'owner_required', error_description: 'An owner reference is required for this request.' });
    return null;
  }
  if (user?.role === 'customer' && user.partyRef !== pathOwnerRef) {
    reply.status(403).send({ error: 'Access denied.' });
    return null;
  }
  return { channel: 'session', ownerPartyRef: pathOwnerRef, actingSubject: user?.partyRef };
}

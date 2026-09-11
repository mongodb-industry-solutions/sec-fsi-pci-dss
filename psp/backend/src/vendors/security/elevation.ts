import { FastifyRequest } from 'fastify';
import { callAuthority, AuthorityError } from './authorityApi';

/**
 * Temporary, case-scoped access, asked of the identity authority.
 *
 * This replaces a signed capability token minted here. That token was sound in what it did: short
 * lived, case scoped, fail closed. It was weak in what it could not do. Nothing could list who held
 * one, nothing could revoke one, and an elevation granted in error ran to its expiry whatever anyone
 * decided afterwards. Both of those are ordinary questions during an incident.
 *
 * The check is a call rather than a claim read, deliberately. An elevation is granted DURING a
 * session, so the caller's existing token predates it and cannot carry it. Waiting for a token
 * refresh would mean an investigator is refused for as long as their token lives, which is the
 * moment they most need the access. Asking the authority costs a round trip on the sensitive reads
 * only, and it is the same trade the platform already documents: verify locally by default,
 * introspect where being wrong is expensive.
 */

export interface ElevationRequest {
  /** The role held for the duration. */
  roleName: string;
  /** What the elevation is bound to: a case, a change window, a customer under review. */
  scopeKind: string;
  scopeRef: string;
  justification: string;
  durationSeconds?: number;
}

/**
 * Asks for an elevation on the caller's own behalf.
 *
 * Returns the identifier, or null when the authority refused. It never falls back to granting the
 * access locally: an elevation the authority declined to record is an elevation nobody can review,
 * which is the whole reason it moved.
 */
export async function requestElevation(
  request: FastifyRequest,
  input: ElevationRequest,
): Promise<string | null> {
  try {
    // The authority addresses an elevation by the (subjectId, roleId) pair, not a separate
    // assignment identifier: that is the whole holding, not a claim about one.
    const created = await callAuthority<{ subjectId: string; roleId: string }>(request, '/elevations', {
      method: 'POST',
      body: input,
    });
    return created.roleId ? `${created.subjectId}:${created.roleId}` : null;
  } catch (error) {
    if (error instanceof AuthorityError) return null;
    throw error;
  }
}

/**
 * Whether the caller currently holds an elevation covering this thing.
 *
 * Fails CLOSED. An authority that cannot be reached yields "no elevation", so an outage narrows
 * access rather than widening it. The alternative, treating an unreachable authority as permission,
 * turns every network problem into an authorisation bypass.
 */
export async function holdsElevation(
  request: FastifyRequest,
  target: { scopeKind: string; scopeRef: string },
): Promise<boolean> {
  try {
    const { elevations } = await callAuthority<{
      elevations: Array<{ subjectId: string; scope?: { kind: string; ref: string } }>;
    }>(request, '/elevations', { query: { state: 'in-force' } });

    const caller = (request as unknown as { user?: { sub?: string } }).user?.sub;
    return elevations.some((elevation) =>
      elevation.subjectId === caller
      && elevation.scope?.kind === target.scopeKind
      && elevation.scope?.ref === target.scopeRef);
  } catch {
    return false;
  }
}

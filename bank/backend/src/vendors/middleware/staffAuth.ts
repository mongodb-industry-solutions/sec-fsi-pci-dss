import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyRealmToken } from '../security/tokenVerifier';
import { BankResource, BankAction, hasBankPermission } from '../../shared/models/permissionCatalog';

/**
 * Authorisation for the bank's OWN people.
 *
 * v39 P7.4: this bank had no users. Its access model was entirely machine to machine, so it could
 * not express that viewing a card's metadata, revealing the number on it and changing a ledger
 * record are three different authorities held by three different people. It can now.
 *
 * Deliberately a SEPARATE middleware from the third-party one, and neither falls back to the other.
 * A third-party operation carries a consent obligation that a staff session does not satisfy, and a
 * staff operation is bounded by a role that a third-party credential does not carry. A token from
 * one path presented on the other is refused, and that refusal is the design rather than an
 * oversight in what each middleware happens to check.
 */
export interface StaffContext {
  subjectId: string;
  roles: string[];
  /** Full permission strings, `resource:action`. Absent unless the client narrowed. */
  permissions: string[];
  /** Present when the person is an account holder acting on their own records. */
  accountHolderRef?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    staff?: StaffContext;
  }
}

function refuse(reply: FastifyReply, status: number, error: string): never {
  if (status === 401) reply.header('WWW-Authenticate', 'Bearer realm="bankcore"');
  return reply.status(status).send({ error }) as never;
}

/**
 * Requires an interactive token carrying the permission an operation needs.
 *
 * Default deny: an absent permissions claim grants nothing, because a token that carries no
 * authority is not a token that carries all of it.
 */
export function requireStaff(resource: BankResource, action: BankAction) {
  return async function handler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(request.headers.authorization ?? '');
    if (!match) return refuse(reply, 401, 'Missing bearer token');

    const claims = await verifyRealmToken(match[1]);
    if (!claims) return refuse(reply, 401, 'Invalid or expired token');

    // An INTERACTIVE token, and only that. A machine credential authenticates as itself, so its
    // subject is its client id; a person's is not. Accepting a machine token here would let a
    // third-party credential reach the bank's back office, which is the boundary this exists to hold.
    if (claims.clientId && claims.sub === claims.clientId) {
      return refuse(reply, 403, 'This endpoint requires a signed-in person, not a machine credential');
    }

    /**
     * The EXPANDED set where the verifier resolved one, the explicit claim otherwise.
     *
     * Since v40 an ordinary token carries roles and no permissions, so reading the explicit claim
     * alone denied every caller. Absence still denies: an unresolved authority must never read as
     * an unrestricted one.
     */
    const held = claims.effectivePermissions ?? claims.permissions;
    if (!hasBankPermission(held, resource, action)) {
      return refuse(reply, 403, `Access denied: your role does not permit ${action} on ${resource}`);
    }

    if (request.server.dbError !== null) {
      return refuse(reply, 503, 'The bank ledger is unavailable');
    }

    request.staff = {
      subjectId: claims.sub,
      roles: claims.roles,
      // The same set the guard decided on, so a downstream check cannot disagree with the gate.
      permissions: held,
      ...(typeof claims.account_holder === 'string' ? { accountHolderRef: claims.account_holder } : {}),
    };
  };
}

/**
 * Binds an account holder to their own records.
 *
 * The `self` scope in practice. An account holder signing in at their own institution needs no
 * consent to see their own accounts, because there is no third party in the arrangement; what they
 * do need is to be unable to see anybody else's, and that is what this enforces.
 */
export function requireOwnAccountHolder(resolveRequestedHolder: (request: FastifyRequest) => string | undefined) {
  return async function handler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const staff = request.staff;
    if (!staff) return refuse(reply, 401, 'Not authenticated');

    // A person holding a bank-wide role is not restricted to themselves; the binding applies to the
    // account-holder role, whose entire scope is its own records.
    if (!staff.accountHolderRef) return;

    const requested = resolveRequestedHolder(request);
    if (requested && requested !== staff.accountHolderRef) {
      return refuse(reply, 403, 'Access denied: this record does not belong to you');
    }
  };
}

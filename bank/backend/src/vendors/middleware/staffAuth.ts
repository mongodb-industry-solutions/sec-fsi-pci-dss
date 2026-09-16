import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyRealmToken } from '../security/tokenVerifier';
import { BankResource, BankAction, hasBankPermission, isSelfScoped } from '../../shared/models/permissionCatalog';

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
  /** True when every record this caller may reach is their own. See `BANK_SELF_SCOPED_ROLES`. */
  selfScoped: boolean;
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

    const accountHolderRef = typeof claims.account_holder === 'string' && claims.account_holder
      ? claims.account_holder
      : undefined;
    const selfScoped = isSelfScoped(claims.roles);

    /**
     * A self-scoped role with NO binding is refused, rather than admitted unbound.
     *
     * Unbound was the previous behaviour and it read as "not restricted to anybody", so an account
     * holder whose principal carried no reference was served every other holder's records. The whole
     * scope of the role is "your own", so not knowing whose it is leaves nothing it may legitimately
     * reach.
     */
    if (selfScoped && !accountHolderRef) {
      return refuse(reply, 403, 'Access denied: this account holder is not bound to a record at this bank');
    }

    request.staff = {
      subjectId: claims.sub,
      roles: claims.roles,
      // The same set the guard decided on, so a downstream check cannot disagree with the gate.
      permissions: held,
      selfScoped,
      ...(accountHolderRef ? { accountHolderRef } : {}),
    };
  };
}

/**
 * Binds an account holder to their own records.
 *
 * The `self` scope in practice. An account holder signing in at their own institution needs no
 * consent to see their own accounts, because there is no third party in the arrangement; what they
 * do need is to be unable to see anybody else's.
 *
 * THE DEFECT THIS FIXES. The previous version of this was exported and never wired to a single
 * route, so the self scope was declared in the role and enforced nowhere: an account holder calling
 * the list endpoints was served the whole bank's accounts and cards, identical to what an operations
 * officer sees. A guard that nothing calls is indistinguishable from no guard.
 *
 * It works by NARROWING THE QUERY rather than by filtering the answer. A list route already accepts
 * a holder filter, so the binding sets it and the search runs scoped; there is no second code path
 * that could disagree with the first, and no page of somebody else's records is ever built and then
 * discarded. A holder asking explicitly for somebody else is refused rather than quietly rewritten,
 * because silently changing what was asked for hides the boundary from whoever is meeting it.
 */
export function bindOwnAccountHolder(queryField: string) {
  return async function handler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const staff = request.staff;
    if (!staff) return refuse(reply, 401, 'Not authenticated');
    // A bank-wide role reaches every record by design; the binding is the self-scoped role's alone.
    if (!staff.selfScoped) return;
    // Unreachable while `requireStaff` refuses an unbound self-scoped caller, and kept so this guard
    // is safe on its own terms rather than only in the company it currently keeps.
    if (!staff.accountHolderRef) return refuse(reply, 403, 'Access denied: no account holder is bound to you');

    const query = request.query as Record<string, unknown>;
    const asked = query[queryField];
    if (typeof asked === 'string' && asked && asked !== staff.accountHolderRef) {
      return refuse(reply, 403, 'Access denied: these records do not belong to you');
    }
    query[queryField] = staff.accountHolderRef;
  };
}

/**
 * The same boundary for a route that names ONE record, checked once the record is in hand.
 *
 * A detail route cannot narrow a query: the reference it was given either belongs to the caller or
 * does not, and which one is only known after the record is read. Returning 403 rather than 404 is
 * deliberate: the caller named a reference they hold no claim on, and a bank telling them "no such
 * account" would be answering a question about somebody else's record.
 */
export function refuseIfNotOwn(
  request: FastifyRequest,
  reply: FastifyReply,
  holderReference: string | null | undefined,
): boolean {
  const staff = request.staff;
  if (!staff?.selfScoped) return false;
  if (holderReference && holderReference === staff.accountHolderRef) return false;
  reply.status(403).send({ error: 'Access denied: this record does not belong to you' });
  return true;
}

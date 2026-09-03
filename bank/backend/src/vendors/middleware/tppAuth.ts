import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyRealmToken } from '../security/tokenVerifier';
import { TppRole, TppScope } from '../../modules/tpp-trust/models/tppRegistration.model';

/**
 * Authorisation for the Open Banking surface.
 *
 * v39 P7: the token is now issued by the identity authority in THIS BANK's realm and verified
 * against that realm's published key set. The bank no longer mints it, and no longer holds a secret
 * that could. What changed is where the trust comes from; the scope check, the role check, the
 * RFC 6750 error shape and the ordering of the availability gate are all unchanged, because those
 * are the bank's own rules about its own API.
 *
 * The realm is what makes the refusal structural. A token from the platform's realm carries a
 * different issuer and was signed by a different key published at a different key set, so it fails
 * here before any claim is examined. Before this, the bank verified a PSP-issued token with a shared
 * secret, and the boundary between two institutions rested on the platform choosing not to mint one.
 */
export interface TppContext {
  clientId: string;
  scopes: TppScope[];
  roles: TppRole[];
}

declare module 'fastify' {
  interface FastifyRequest {
    tpp?: TppContext;
  }
}

function refuse(reply: FastifyReply, status: number, code: string, text: string): never {
  if (status === 401) reply.header('WWW-Authenticate', 'Bearer realm="bankcore"');
  return reply.status(status).send({
    tppMessages: [{ category: 'ERROR', code, text }],
  }) as never;
}

/**
 * Requires a TPP token, plus the scope and the PSD2 role the endpoint needs.
 *
 * Both are checked. A scope says which operation group; a role says which capacity the third party
 * is acting in, and a real institution grants those independently.
 */
export function requireTpp(scope?: TppScope, role?: TppRole) {
  return async function handler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(request.headers.authorization ?? '');
    // RFC 6750 shape: a third party must be able to tell "no token" from "wrong scope".
    if (!match) return refuse(reply, 401, 'TOKEN_INVALID', 'Missing bearer token');

    const claims = await verifyRealmToken(match[1]);
    if (!claims) return refuse(reply, 401, 'TOKEN_INVALID', 'Invalid or expired access token');

    /**
     * A machine token, and only a machine token.
     *
     * An interactive token presented here is refused even when the person holding it is an
     * administrator. A third-party operation carries a consent obligation that a staff session does
     * not satisfy, so the two grants must never substitute for each other, in either direction.
     */
    if (!claims.clientId || claims.sub !== claims.clientId) {
      return refuse(reply, 403, 'TOKEN_INVALID', 'This endpoint requires a registered third-party credential');
    }

    if (scope && !claims.scope.includes(scope)) {
      return refuse(reply, 403, 'TOKEN_INVALID', `The access token lacks the '${scope}' scope`);
    }

    // The PSD2 capacities this third party is registered for, carried as permissions the authority
    // resolved from its role. The bank still decides what each capacity may reach.
    /**
     * The PSD2 capacities carried as permission STRINGS since v40, `psd2Role:<capacity>`.
     *
     * Read from the expanded set where the verifier had a catalog, because the explicit claim is
     * absent on an ordinary token: a third party is registered through its ROLE, and the role is
     * what the token now carries by default.
     */
    const held = claims.effectivePermissions ?? claims.permissions;
    const roles = held
      .filter((permission) => permission.startsWith('psd2Role:'))
      .map((permission) => permission.slice('psd2Role:'.length) as TppRole);
    if (role && !roles.includes(role)) {
      return refuse(reply, 403, 'ROLE_INVALID', `This third party is not registered as ${role}`);
    }

    // Checked only once the caller is authorised, so an unauthenticated request never reaches the
    // database. A bank whose ledger is unreachable is unavailable, not broken.
    if (request.server.dbError !== null) {
      return refuse(reply, 503, 'SERVICE_BLOCKED', 'The bank ledger is unavailable');
    }

    request.tpp = {
      clientId: claims.clientId,
      scopes: claims.scope as TppScope[],
      roles,
    };
  };
}

import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../../modules/tpp-trust/services/tppAccessToken.service';
import { TppRole, TppScope } from '../../modules/tpp-trust/models/tppRegistration.model';

// Authorisation for the Open Banking surface: a token this bank issued to a registered TPP through the
// client credentials grant, scoped per operation group and per PSD2 role.
//
// The token is signed with the bank's own key, so a JWT minted anywhere else on the platform is
// refused. That is the point: before this, any holder of a platform token could read accounts.
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
 * Requires a valid TPP token, plus the scope and role the endpoint needs. Both are checked: a scope
 * says which operation group, a role says which PSD2 capacity the TPP is acting in, and a real ASPSP
 * grants them independently.
 */
export function requireTpp(scope?: TppScope, role?: TppRole) {
  return async function handler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(request.headers.authorization ?? '');
    // RFC 6750 shape: a TPP must be able to tell "no token" from "wrong scope".
    if (!match) return refuse(reply, 401, 'TOKEN_INVALID', 'Missing bearer token');

    const claims = verifyAccessToken(match[1]);
    if (!claims) return refuse(reply, 401, 'TOKEN_INVALID', 'Invalid or expired access token');

    if (scope && !claims.scopes.includes(scope)) {
      return refuse(reply, 403, 'TOKEN_INVALID', `The access token lacks the '${scope}' scope`);
    }
    if (role && !claims.roles.includes(role)) {
      return refuse(reply, 403, 'ROLE_INVALID', `This TPP is not registered as ${role}`);
    }

    // Checked only once the caller is authorised, so an unauthenticated request never reaches the
    // database. A bank whose ledger is unreachable is unavailable, not broken.
    if (request.server.dbError !== null) {
      return refuse(reply, 503, 'SERVICE_BLOCKED', 'The bank ledger is unavailable');
    }

    request.tpp = { clientId: claims.clientId, scopes: claims.scopes, roles: claims.roles };
  };
}

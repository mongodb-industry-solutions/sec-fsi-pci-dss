import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

// Authorisation for the Open Banking surface. bankcore has a public hostname so its API can be
// reviewed, which means account data cannot be one unauthenticated request away.
//
// INTERIM implementation, deliberately narrow: the token is a bearer JWT signed with the shared
// platform secret, so only the PSP can mint one. P3.7b replaces the verification with
// `grant_type=client_credentials` against a registered `tppRegistration`, with scopes and roles. The
// call sites do not change when it does: they already require "a valid TPP token", which is what the
// specification's security scheme says. What changes is who issues it and what it carries.
export interface TppContext {
  clientId: string;
  scopes: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    tpp?: TppContext;
  }
}

export async function requireTpp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(request.headers.authorization ?? '');
  if (!match) {
    // RFC 6750 shape: a TPP client must be able to tell "no token" from "wrong scope".
    reply.header('WWW-Authenticate', 'Bearer realm="bankcore"');
    return reply.status(401).send({
      tppMessages: [{ category: 'ERROR', code: 'TOKEN_INVALID', text: 'Missing bearer token' }],
    }) as never;
  }
  try {
    const payload = jwt.verify(match[1], config.app.jwtSecret) as jwt.JwtPayload;
    request.tpp = {
      clientId: (payload.client_id as string) ?? (payload.sub as string) ?? 'psp',
      scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
    };
  } catch {
    return reply.status(401).send({
      tppMessages: [{ category: 'ERROR', code: 'TOKEN_INVALID', text: 'Invalid bearer token' }],
    }) as never;
  }
}

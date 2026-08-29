import { FastifyInstance } from 'fastify';
import { authorityProxyController } from './controllers/authorityProxy.controller';
import { consentGrantsController } from './controllers/consentGrants.controller';

/**
 * What is left of identity here: a view of the user's own authorizations, and a compatibility shim.
 *
 * This application no longer authenticates anyone. It holds no user store, no role table, no signing
 * key and no session, and the controllers that used to provide them are gone from the routing table.
 * The authority owns all of it.
 *
 * The proxy is registered instead, because one client resolves business and authentication calls
 * from a single base URL and repointing that base would take the business endpoints with it. It
 * forwards and does nothing else.
 */
export async function identityModule(fastify: FastifyInstance) {
  // The user's own authorizations, read from the authority rather than from a local collection.
  await fastify.register(consentGrantsController, { prefix: '/auth' });
  // Registered last, so an explicit route above always wins over a forwarded one.
  await fastify.register(authorityProxyController, { prefix: '/auth' });
}

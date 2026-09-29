import { FastifyInstance } from 'fastify';
import { authorityProxyController } from './controllers/authorityProxy.controller';
import { consentGrantsController } from './controllers/consentGrants.controller';
import { selfProfileController } from './controllers/selfProfile.controller';
import { directoryController } from './controllers/directory.controller';
import { authDomainController } from './controllers/authDomain.controller';

/**
 * What is left of identity here: a person's own profile, a view of their authorizations, and a shim.
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
  // A person's own profile: identity from the token, agreement and party from this product's data.
  await fastify.register(selfProfileController, { prefix: '/auth' });
  /**
   * The console's directory reads, at the paths the console already calls.
   *
   * No prefix: `/acl/effective`, `/roles` and `/users` are not under `/auth` and never were. The
   * console's contract is the thing being repaired here, so moving it would be repairing one break
   * by making another.
   */
  await fastify.register(directoryController);
  /**
   * Authentication domain administration, under `/modules` because that is where the console's
   * contract puts it. The records live at the authority; this is the vocabulary translation.
   */
  await fastify.register(authDomainController, { prefix: '/modules' });
  // The user's own authorizations, read from the authority rather than from a local collection.
  await fastify.register(consentGrantsController, { prefix: '/auth' });
  // Registered last, so an explicit route above always wins over a forwarded one.
  await fastify.register(authorityProxyController, { prefix: '/auth' });
}

import { FastifyInstance } from 'fastify';

// Realms and the upstream providers federated inside them. A realm is a trust and key boundary; an
// identityProvider row is how a third-party IdP joins one without any application learning of it.
export async function realmModule(_fastify: FastifyInstance) {
  // Routes arrive with the module's own phase.
}

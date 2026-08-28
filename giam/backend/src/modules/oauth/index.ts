import { FastifyInstance } from 'fastify';

// The authorization server: discovery, authorize, token, refresh, introspection, revocation,
// userinfo and exchange, plus the client registry those operate against.
export async function oauthModule(_fastify: FastifyInstance) {
  // Routes arrive with the module's own phase.
}

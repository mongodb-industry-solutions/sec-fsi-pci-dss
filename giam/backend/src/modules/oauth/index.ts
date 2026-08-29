import { FastifyInstance } from 'fastify';
import { discoveryController } from './controllers/discovery.controller';
import { tokenController } from './controllers/token.controller';
import { authorizeController } from './controllers/authorize.controller';

// The authorization server: discovery, the published key set, and the token endpoint. Every route
// here implements a specification verbatim, so the paths carry the standard's own shape rather than
// this project's.
export async function oauthModule(fastify: FastifyInstance) {
  await fastify.register(discoveryController);
  await fastify.register(authorizeController);
  await fastify.register(tokenController);
}

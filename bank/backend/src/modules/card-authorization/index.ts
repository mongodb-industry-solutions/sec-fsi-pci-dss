import { FastifyInstance } from 'fastify';
import { cardAuthorisationController } from './controllers/cardAuthorisation.controller';

// Card authorisation: the issuer's hold, in ISO 8583 terms. Not Berlin Group, which has nothing to say
// about card rails, but on the same /v1 surface because it IS an operation the PSP calls.
export async function cardAuthorizationModule(fastify: FastifyInstance) {
  await fastify.register(cardAuthorisationController, { prefix: '/v1' });
}

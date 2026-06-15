import { FastifyInstance } from 'fastify';
import { cardAuthorizationController } from './controllers/cardAuthorization.controller';

export async function cardAuthorizationModule(fastify: FastifyInstance) {
  await fastify.register(cardAuthorizationController, { prefix: '/modules/card-authorization' });
}

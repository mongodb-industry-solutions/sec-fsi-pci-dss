import { FastifyInstance } from 'fastify';
import { cardIssuerController } from './controllers/cardIssuer.controller';

export async function cardIssuerModule(fastify: FastifyInstance) {
  await fastify.register(cardIssuerController, { prefix: '/modules/card-issuer' });
}

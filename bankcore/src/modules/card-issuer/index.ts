import { FastifyInstance } from 'fastify';
import { cardIssuerController } from './controllers/cardIssuer.controller';

// The card issuer: the vault holding the only full PANs on this platform, the registry of what was
// issued, and the validation the acceptance side calls instead of holding cardholder data itself.
export async function cardIssuerModule(fastify: FastifyInstance) {
  await fastify.register(cardIssuerController, { prefix: '/v1' });
}

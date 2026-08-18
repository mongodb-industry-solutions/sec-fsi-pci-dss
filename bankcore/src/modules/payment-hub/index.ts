import { FastifyInstance } from 'fastify';
import { fundsConfirmationController } from './controllers/fundsConfirmation.controller';

// Payment hub: funds validation now, execution (debit, rail routing, clearing) in its own phase.
export async function paymentHubModule(fastify: FastifyInstance) {
  await fastify.register(fundsConfirmationController, { prefix: '/v1' });
}

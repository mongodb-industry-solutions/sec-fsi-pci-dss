import { FastifyInstance } from 'fastify';
import { accountInformationController } from './controllers/accountInformation.controller';

// Mounted at /v1, which is where Berlin Group puts it. No vendor prefix: a standard client must not
// need to know anything about this implementation to call it.
export async function aispModule(fastify: FastifyInstance) {
  await fastify.register(accountInformationController, { prefix: '/v1' });
}

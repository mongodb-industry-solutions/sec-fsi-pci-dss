import { FastifyInstance } from 'fastify';
import { hrpController } from './controllers/hrp.controller';

// HRP capability module (internal sanctions/PEP screening engine). Reused by the fraud domain module.
export async function hrpModule(fastify: FastifyInstance) {
  await fastify.register(hrpController, { prefix: '/modules/hrp' });
}

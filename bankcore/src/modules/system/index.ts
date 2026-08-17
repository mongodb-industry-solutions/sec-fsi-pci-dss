import { FastifyInstance } from 'fastify';
import { systemController } from './controllers/system.controller';

export async function systemModule(fastify: FastifyInstance) {
  await fastify.register(systemController, { prefix: '/system' });
}

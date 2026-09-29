import { FastifyInstance } from 'fastify';
import { kybController } from './controllers/kyb.controller';

export async function kybModule(fastify: FastifyInstance) {
  await fastify.register(kybController, { prefix: '/modules/kyb' });
}

import { FastifyInstance } from 'fastify';
import { demoController } from './controllers/demo.controller';

export async function systemModule(fastify: FastifyInstance) {
  await fastify.register(demoController, { prefix: '/system' });
}

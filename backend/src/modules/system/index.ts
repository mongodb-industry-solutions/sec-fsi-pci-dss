import { FastifyInstance } from 'fastify';
import { demoController } from './controllers/demo.controller';
import { simulatorController } from './controllers/simulator.controller';

export async function systemModule(fastify: FastifyInstance) {
  await fastify.register(demoController, { prefix: '/system' });
  await fastify.register(simulatorController, { prefix: '/system/simulator' });
}

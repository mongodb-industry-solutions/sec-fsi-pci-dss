import { FastifyInstance } from 'fastify';
import { amlController } from './controllers/aml.controller';

export async function amlModule(fastify: FastifyInstance) {
  await fastify.register(amlController, { prefix: '/modules/aml' });
}

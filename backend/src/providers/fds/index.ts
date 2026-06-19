import { FastifyInstance } from 'fastify';
import { fdsController } from './controllers/fds.controller';

// FDS capability module (internal Fraud Detection engine). Reused by the fraud domain module.
export async function fdsModule(fastify: FastifyInstance) {
  await fastify.register(fdsController, { prefix: '/modules/fds' });
}

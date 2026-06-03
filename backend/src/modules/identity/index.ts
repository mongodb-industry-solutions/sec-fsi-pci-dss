import { FastifyInstance } from 'fastify';
import { authController } from './controllers/auth.controller';

export async function identityModule(fastify: FastifyInstance) {
  await fastify.register(authController, { prefix: '/auth' });
}

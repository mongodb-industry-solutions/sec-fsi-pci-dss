import { FastifyInstance } from 'fastify';
import { adminController } from './controllers/admin.controller';

export async function adminModule(fastify: FastifyInstance) {
  await fastify.register(adminController, { prefix: '/admin' });
}

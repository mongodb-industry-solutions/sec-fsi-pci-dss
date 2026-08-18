import { FastifyInstance } from 'fastify';
import { bankAdminController } from './controllers/bankAdmin.controller';

// Bank administration, at /api/v1/admin: REST but explicitly NOT the Open Banking surface, since no
// standard covers configuring an engine or suspending a TPP.
export async function adminModule(fastify: FastifyInstance) {
  await fastify.register(bankAdminController, { prefix: '/admin' });
}

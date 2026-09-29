import { FastifyInstance } from 'fastify';
import { bankAdminController } from './controllers/bankAdmin.controller';
import { bankDataAdminController } from './controllers/bankDataAdmin.controller';

// Bank administration, at /api/v1/admin: REST but explicitly NOT the Open Banking surface, since no
// standard covers configuring an engine or suspending a TPP.
export async function adminModule(fastify: FastifyInstance) {
  await fastify.register(bankAdminController, { prefix: '/admin' });
  // The bank's own DATA: the cards it issued and the accounts it holds, with the filters, search and paging
  // an operator needs. Separate from the Open Banking surface, which serves a third party under a consent.
  await fastify.register(bankDataAdminController, { prefix: '/admin' });
}

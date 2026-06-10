import { FastifyInstance } from 'fastify';
import { adminController } from './controllers/admin.controller';
import { webhookInspectorController } from './controllers/webhookInspector.controller';

export async function adminModule(fastify: FastifyInstance) {
  await fastify.register(adminController, { prefix: '/admin' });
  await fastify.register(webhookInspectorController, { prefix: '/admin/webhook' });
}

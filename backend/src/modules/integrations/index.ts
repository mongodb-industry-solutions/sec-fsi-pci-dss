import { FastifyInstance } from 'fastify';
import { integrationRegistryController } from './controllers/integrationRegistry.controller';
import { integrationWebhookController }  from './controllers/integrationWebhook.controller';

export async function integrationsModule(fastify: FastifyInstance) {
  await fastify.register(integrationRegistryController, { prefix: '/integrations' });
  await fastify.register(integrationWebhookController,  { prefix: '/webhooks' });
}

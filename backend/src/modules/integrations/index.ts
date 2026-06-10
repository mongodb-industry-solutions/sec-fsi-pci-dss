import { FastifyInstance } from 'fastify';
import { integrationRegistryController }     from './controllers/integrationRegistry.controller';
import { integrationWebhookController }      from './controllers/integrationWebhook.controller';
import { integrationRoutingGroupController } from './controllers/integrationRoutingGroup.controller';

export async function integrationsModule(fastify: FastifyInstance) {
  await fastify.register(integrationRegistryController,     { prefix: '/integrations/providers' });
  await fastify.register(integrationWebhookController,      { prefix: '/webhooks' });
  await fastify.register(integrationRoutingGroupController, { prefix: '/integrations/groups' });
}

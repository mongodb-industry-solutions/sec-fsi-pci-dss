import { FastifyInstance } from 'fastify';
import { integrationRegistryController }     from './controllers/integrationRegistry.controller';
import { integrationWebhookController }      from './controllers/integrationWebhook.controller';
import { integrationRoutingGroupController } from './controllers/integrationRoutingGroup.controller';
import { processEventController }            from './controllers/processEvent.controller';

// Internal `/internal/<cap>/score` catch-all removed (ADR-029): each capability owns a static
// `/api/v1/modules/<cap>/...` controller (modules/<cap>); internal vendors are re-pointed to those.
export async function providersModule(fastify: FastifyInstance) {
  await fastify.register(integrationRegistryController,     { prefix: '/providers/vendors' });
  await fastify.register(integrationWebhookController,      { prefix: '/providers/callback' });
  await fastify.register(integrationRoutingGroupController, { prefix: '/providers/groups' });
  await fastify.register(processEventController,            { prefix: '/events' });
}

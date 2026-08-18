import { FastifyInstance } from 'fastify';
import { integrationRegistryController }     from './controllers/integrationRegistry.controller';
import { integrationWebhookController }      from './controllers/integrationWebhook.controller';
import { providerEventCallbackController }   from './controllers/providerEventCallback.controller';
import { integrationRoutingGroupController } from './controllers/integrationRoutingGroup.controller';
import { processEventController }            from './controllers/processEvent.controller';
import { bankcoreNotificationController }    from './controllers/bankcoreNotification.controller';

// Internal `/internal/<cap>/score` catch-all removed (ADR-029): each capability owns a static
// `/api/v1/modules/<cap>/...` controller (modules/<cap>); internal vendors are re-pointed to those.
export async function providersModule(fastify: FastifyInstance) {
  await fastify.register(integrationRegistryController,     { prefix: '/providers/vendors' });
  await fastify.register(integrationWebhookController,      { prefix: '/providers/callback' });
  // §7.7 per-event callback: /api/v1/providers/{group}/{vendorId}/{event}/callback
  await fastify.register(providerEventCallbackController,   { prefix: '/providers' });
  await fastify.register(integrationRoutingGroupController, { prefix: '/providers/groups' });
  await fastify.register(processEventController,            { prefix: '/events' });
  // The bank's Security Event Tokens (v37 P4.2). Same family as the callbacks above, different
  // authentication: a signed JWS verified through the bank's key set, not an HMAC on a shared secret.
  await fastify.register(bankcoreNotificationController,    { prefix: '/providers/callback' });
}

import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from '../config';

// The bank's own API documentation. Private service, so this is for operators and for the PSP team,
// never for a browser on the public internet.
async function swaggerPlugin(fastify: FastifyInstance) {
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'bankcore API',
        description:
          'Open Banking (Berlin Group NextGenPSD2 shaped) API of the demo ASPSP behind Leafy Pay. '
          + 'Consent, account information, payment initiation, funds confirmation, card issuing and '
          + 'card authorisation. BIAN control records are internal; this surface is the standard one.',
        version: '1.0.0',
      },
      servers: [{ url: config.server.baseUrl, description: 'private, service to service' }],
      tags: [
        { name: 'system', description: 'health and diagnostics' },
        { name: 'oauth', description: 'TPP client credentials' },
        { name: 'consent', description: 'PSD2 consent lifecycle' },
        { name: 'accounts', description: 'account information (AIS)' },
        { name: 'payments', description: 'payment initiation (PIS)' },
        { name: 'cards', description: 'card issuing and authorisation' },
        { name: 'admin', description: 'bank administration, reached through the PSP' },
      ],
      components: {
        securitySchemes: {
          tppToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  });

  await fastify.register(swaggerUi, { routePrefix: '/doc' });
}

export default fp(swaggerPlugin, { name: 'swagger' });

// Card Authorization capability module controller: STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { requirePermission } from '../../../vendors/middleware/acl';
import { authorizeCard } from '../services/cardAuthorization.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';

export async function cardAuthorizationController(fastify: FastifyInstance) {
  const CAP = 'card-authorization';

  fastify.post('/score', {
    schema: {
      tags: ['modules:card-authorization'],
      summary: 'Card authorization engine invocation (internal loopback)',
      description: 'Internal card-authorization network engine. Called by the integration router (ADR-029) '
        + 'when no external card-authorization vendor is active. Returns an authorization decision for the transaction. '
        + 'PCI DSS Req 3.3: no CVV is accepted or stored. Not JWT-authenticated; requires `X-Integration-Source` header.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string', description: 'Caller identity header.' } } },
      body: { type: 'object', additionalProperties: true, description: 'Card transaction payload forwarded by the integration router. Must not include CVV.' },
      response: {
        200: {
          type: 'object',
          description: 'Card authorization result.',
          properties: {
            authorizationCode:   { type: 'string', description: 'Network authorization code (e.g. AUTH123456). Present on approval.' },
            authorizationStatus: { type: 'string', enum: ['approved', 'declined', 'pending'], description: 'Authorization decision.' },
            responseCode:        { type: 'string', description: 'ISO 8583 response code (e.g. 00 = approved, 05 = declined).' },
          },
        },
        401: { type: 'object', properties: { error: { type: 'string' } }, description: 'Missing X-Integration-Source header.' },
      },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }
    return reply.send(authorizeCard(request.body as Record<string, unknown>));
  });

  fastify.get('/config', {
    preHandler: requirePermission('modules', 'view'),
    schema: {
      tags: ['modules:card-authorization'],
      summary: 'Get card-authorization module configuration',
      description: 'Returns the active card-authorization engine configuration.',
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', {
    preHandler: requirePermission('modules', 'manage'),
    schema: {
      tags: ['modules:card-authorization'],
      summary: 'Update card-authorization module configuration',
      description: 'Replaces the card-authorization engine configuration. Changes take effect on the next engine invocation.',
      body: { type: 'object', properties: { moduleConfig: { type: 'object', additionalProperties: true } } },
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

// Card Authorization capability module controller — STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { authorizeCard } from '../services/cardAuthorization.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../providers/services/capabilityModuleConfig.service';

export async function cardAuthorizationController(fastify: FastifyInstance) {
  const CAP = 'card-authorization';

  fastify.post('/score', {
    schema: {
      tags: ['modules:card-authorization'],
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string' } } },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }
    return reply.send(authorizeCard(request.body as Record<string, unknown>));
  });

  fastify.get('/config', { schema: { tags: ['modules:card-authorization'] } }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', { schema: { tags: ['modules:card-authorization'] } }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

// Card Issuer capability module controller — STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { validateCardIssuer } from '../services/cardIssuer.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../providers/services/capabilityModuleConfig.service';

export async function cardIssuerController(fastify: FastifyInstance) {
  const CAP = 'card-issuer';

  fastify.post('/score', {
    schema: {
      tags: ['modules:card-issuer'],
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string' } } },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }
    return reply.send(validateCardIssuer(request.body as Record<string, unknown>));
  });

  fastify.get('/config', { schema: { tags: ['modules:card-issuer'] } }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', { schema: { tags: ['modules:card-issuer'] } }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

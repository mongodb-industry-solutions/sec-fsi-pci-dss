// AML capability module controller — STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { screenAml } from '../services/aml.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';

export async function amlController(fastify: FastifyInstance) {
  const CAP = 'aml';

  fastify.post('/score', {
    schema: {
      tags: ['modules:aml'],
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string' } } },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }
    return reply.send(screenAml(request.body as Record<string, unknown>));
  });

  fastify.get('/config', { schema: { tags: ['modules:aml'] } }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', { schema: { tags: ['modules:aml'] } }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

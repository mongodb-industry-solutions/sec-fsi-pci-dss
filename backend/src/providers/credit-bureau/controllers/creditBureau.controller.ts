// Credit Bureau capability module controller — STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { scoreCreditBureau } from '../services/creditBureau.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/providers/services/capabilityModuleConfig.service';

export async function creditBureauController(fastify: FastifyInstance) {
  const CAP = 'credit-bureau';

  fastify.post('/score', {
    schema: {
      tags: ['modules:credit-bureau'],
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string' } } },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }
    return reply.send(scoreCreditBureau(request.body as Record<string, unknown>));
  });

  fastify.get('/config', { schema: { tags: ['modules:credit-bureau'] } }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', { schema: { tags: ['modules:credit-bureau'] } }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

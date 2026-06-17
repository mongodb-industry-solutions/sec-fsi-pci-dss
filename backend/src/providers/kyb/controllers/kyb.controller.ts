// KYB capability module controller — STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { verifyKyb } from '../services/kyb.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/providers/services/capabilityModuleConfig.service';

export async function kybController(fastify: FastifyInstance) {
  const CAP = 'kyb';

  fastify.post('/score', {
    schema: {
      tags: ['modules:kyb'],
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string' } } },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }
    return reply.send(verifyKyb(request.body as Record<string, unknown>));
  });

  fastify.get('/config', { schema: { tags: ['modules:kyb'] } }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', { schema: { tags: ['modules:kyb'] } }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

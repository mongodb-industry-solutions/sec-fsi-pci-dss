// HRP capability module controller — STATIC routes (ADR-029).
//   POST /api/v1/modules/hrp/screen   — evaluate an individual (replaces old /integrations/hrp/screen)
//   GET/PUT /api/v1/modules/hrp/config — admin config
import { FastifyInstance } from 'fastify';
import { screenHrp, HrpConfig } from '../services/hrp.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../providers/services/capabilityModuleConfig.service';

export async function hrpController(fastify: FastifyInstance) {
  const CAP = 'hrp';

  fastify.post('/screen', {
    schema: {
      tags: ['modules:hrp'],
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string' } } },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }
    const cfg = await getCapabilityModuleConfig(fastify.db, CAP);
    const config = cfg?.moduleConfig as Partial<HrpConfig> | undefined;
    return reply.send(screenHrp(request.body as Record<string, unknown>, config));
  });

  fastify.get('/config', { schema: { tags: ['modules:hrp'] } }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', { schema: { tags: ['modules:hrp'] } }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

// HRP capability module controller — STATIC routes (ADR-029).
//   POST /api/v1/modules/hrp/screen   — evaluate an individual (replaces old /integrations/hrp/screen)
//   GET/PUT /api/v1/modules/hrp/config — admin config
import { FastifyInstance } from 'fastify';
import { screenHrp, HrpConfig } from '../services/hrp.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';

export async function hrpController(fastify: FastifyInstance) {
  const CAP = 'hrp';

  fastify.post('/screen', {
    schema: {
      tags: ['modules:hrp'],
      summary: 'HRP/Sanctions engine invocation (internal loopback)',
      description: 'Internal High-Risk Person / sanctions / PEP screening engine. Called by the integration router (ADR-029) '
        + 'when no external HRP or sanctions vendor is active. Checks the individual against OFAC, PEP, and custom lists. '
        + 'Not JWT-authenticated; requires `X-Integration-Source` header.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string', description: 'Caller identity header.' } } },
      body: { type: 'object', additionalProperties: true, description: 'Individual identity payload forwarded by the integration router.' },
      response: {
        200: {
          type: 'object',
          description: 'HRP screening result.',
          properties: {
            sanctionsHit:  { type: 'boolean', description: 'True if the individual matched a sanctions list.' },
            pepHit:        { type: 'boolean', description: 'True if the individual matched a PEP (Politically Exposed Person) list.' },
            matchedLists:  { type: 'array', items: { type: 'string' }, description: 'Names of the lists that matched.' },
            riskRating:    { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Overall risk rating.' },
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
    const cfg = await getCapabilityModuleConfig(fastify.db, CAP);
    const config = cfg?.moduleConfig as Partial<HrpConfig> | undefined;
    return reply.send(screenHrp(request.body as Record<string, unknown>, config));
  });

  fastify.get('/config', {
    schema: {
      tags: ['modules:hrp'],
      summary: 'Get HRP module configuration',
      description: 'Returns the active HRP/sanctions engine configuration (screening list names, thresholds).',
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', {
    schema: {
      tags: ['modules:hrp'],
      summary: 'Update HRP module configuration',
      description: 'Replaces the HRP/sanctions engine configuration (e.g. custom screening list names). Changes take effect on the next invocation.',
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

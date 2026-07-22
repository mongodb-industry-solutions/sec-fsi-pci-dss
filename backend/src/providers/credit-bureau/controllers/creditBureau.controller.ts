// Credit Bureau capability module controller — STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { requirePermission } from '../../../vendors/middleware/acl';
import { scoreCreditBureau } from '../services/creditBureau.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';

export async function creditBureauController(fastify: FastifyInstance) {
  const CAP = 'credit-bureau';

  fastify.post('/score', {
    schema: {
      tags: ['modules:credit-bureau'],
      summary: 'Credit bureau engine invocation (internal loopback)',
      description: 'Internal credit-bureau scoring engine. Called by the integration router (ADR-029) '
        + 'when no external credit-bureau vendor is active. Returns a credit score and risk rating for the subject. '
        + 'Not JWT-authenticated; requires `X-Integration-Source` header.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string', description: 'Caller identity header.' } } },
      body: { type: 'object', additionalProperties: true, description: 'Customer or business identity payload forwarded by the integration router.' },
      response: {
        200: {
          type: 'object',
          description: 'Credit bureau scoring result.',
          properties: {
            creditScore:        { type: 'number', description: 'Credit score (e.g. 300–850 scale).' },
            creditRating:       { type: 'string', description: 'Letter rating (e.g. A, B, C).' },
            defaultProbability: { type: 'number', description: 'Estimated probability of default (0–1).' },
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
    return reply.send(scoreCreditBureau(request.body as Record<string, unknown>));
  });

  fastify.get('/config', {
    preHandler: requirePermission('modules', 'view'),
    schema: {
      tags: ['modules:credit-bureau'],
      summary: 'Get credit-bureau module configuration',
      description: 'Returns the active credit-bureau engine configuration.',
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
      tags: ['modules:credit-bureau'],
      summary: 'Update credit-bureau module configuration',
      description: 'Replaces the credit-bureau engine configuration. Changes take effect on the next engine invocation.',
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

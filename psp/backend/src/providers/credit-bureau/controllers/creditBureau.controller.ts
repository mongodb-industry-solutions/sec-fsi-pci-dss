// Credit Bureau capability module controller: STATIC routes (ADR-029).
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
      description: 'Credit bureau capability. Called by the integration router when no external bureau vendor '
        + 'is active, and answered by the bank that holds the accounts, since that is where the balances and the '
        + 'payment history an assessment is made of live. Returns the score with the factors that produced it. '
        + 'Not JWT-authenticated; requires `X-Integration-Source` header.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string', description: 'Caller identity header.' } } },
      body: { type: 'object', additionalProperties: true, description: 'Customer or business identity payload forwarded by the integration router.' },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          description: 'Credit bureau scoring result, with the factors that produced it.',
          properties: {
            creditScore:        { type: 'number', description: 'Credit score, 300 to 850.' },
            creditRating:       { type: 'string', description: 'Letter rating, A to E.' },
            defaultProbability: { type: 'number', description: 'Estimated probability of default, 0 to 1.' },
            assessmentFactors:  { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'What produced the score.' },
            assessmentAsOfDateTime: { type: 'string' },
          },
        },
        401: { type: 'object', properties: { error: { type: 'string' } }, description: 'Missing X-Integration-Source header.' },
        502: { type: 'object', additionalProperties: true, properties: { error: { type: 'string' } }, description: 'The bureau could not be reached or refused. Never answered with a default score.' },
      },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }
    const result = await scoreCreditBureau(request.body as Record<string, unknown>, request.id);
    // Reported, not substituted: a decision taken on an invented score is worse than one that waits.
    if (result.error) return reply.code(502).send({ error: result.error });
    return reply.send(result);
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

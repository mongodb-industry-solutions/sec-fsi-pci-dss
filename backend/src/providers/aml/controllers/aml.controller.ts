// AML capability module controller — STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { requirePermission } from '../../../vendors/middleware/acl';
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
      summary: 'AML engine invocation (internal loopback)',
      description: 'Internal Anti-Money Laundering screening engine. Called by the integration router (endpoint-first loopback, ADR-029) '
        + 'when no external AML vendor is active. Screens the payload for suspicious transaction patterns. '
        + 'Not JWT-authenticated; requires `X-Integration-Source` header.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string', description: 'Caller identity header.' } } },
      body: { type: 'object', additionalProperties: true, description: 'Transaction or party payload forwarded by the integration router.' },
      response: {
        200: {
          type: 'object',
          description: 'AML screening result.',
          properties: {
            alertLevel:       { type: 'string', enum: ['none', 'low', 'medium', 'high'], description: 'Severity of the AML alert.' },
            matchedPatterns:  { type: 'array', items: { type: 'string' }, description: 'List of pattern names that triggered the alert.' },
            requiresReview:   { type: 'boolean', description: 'True when the case must be escalated for manual review.' },
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
    return reply.send(screenAml(request.body as Record<string, unknown>));
  });

  fastify.get('/config', {
    preHandler: requirePermission('modules', 'view'),
    schema: {
      tags: ['modules:aml'],
      summary: 'Get AML module configuration',
      description: 'Returns the active AML engine configuration (screening rules, thresholds).',
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
      tags: ['modules:aml'],
      summary: 'Update AML module configuration',
      description: 'Replaces the AML engine configuration. Changes take effect on the next engine invocation.',
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

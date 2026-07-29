// KYB capability module controller — STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { requirePermission } from '../../../vendors/middleware/acl';
import { verifyKyb } from '../services/kyb.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';

export async function kybController(fastify: FastifyInstance) {
  const CAP = 'kyb';

  fastify.post('/score', {
    schema: {
      tags: ['modules:kyb'],
      summary: 'KYB engine invocation (internal loopback)',
      description: 'Internal Know Your Business verification engine. Called by the integration router (ADR-029) '
        + 'when no external KYB vendor is active. Checks company registration, beneficial ownership, and sanctions exposure. '
        + 'Not JWT-authenticated; requires `X-Integration-Source` header.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string', description: 'Caller identity header.' } } },
      body: { type: 'object', additionalProperties: true, description: 'Business entity payload forwarded by the integration router.' },
      response: {
        200: {
          type: 'object',
          description: 'KYB verification result.',
          properties: {
            verificationStatus: { type: 'string', enum: ['pass', 'fail', 'review'], description: 'Outcome of the business verification.' },
            businessRiskLevel:  { type: 'string', enum: ['low', 'medium', 'high'], description: 'Assessed business risk level.' },
            sanctionsMatch:     { type: 'boolean', description: 'True if the entity matched a sanctions list.' },
            failureReasons:     { type: 'array', items: { type: 'string' }, description: 'Reasons for failure or review.' },
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
    return reply.send(verifyKyb(request.body as Record<string, unknown>));
  });

  fastify.get('/config', {
    preHandler: requirePermission('modules', 'view'),
    schema: {
      tags: ['modules:kyb'],
      summary: 'Get KYB module configuration',
      description: 'Returns the active KYB engine configuration.',
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
      tags: ['modules:kyb'],
      summary: 'Update KYB module configuration',
      description: 'Replaces the KYB engine configuration. Changes take effect on the next engine invocation.',
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

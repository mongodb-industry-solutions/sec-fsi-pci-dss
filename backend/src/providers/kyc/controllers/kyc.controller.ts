// KYC capability module controller — STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { verifyKyc } from '../services/kyc.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';

export async function kycController(fastify: FastifyInstance) {
  const CAP = 'kyc';

  fastify.post('/score', {
    schema: {
      tags: ['modules:kyc'],
      summary: 'KYC engine invocation (internal loopback)',
      description: 'Internal Know Your Customer identity-verification engine. Called by the integration router (ADR-029) '
        + 'when no external KYC vendor is active. Returns a verification decision for the customer payload. '
        + 'Not JWT-authenticated; requires `X-Integration-Source` header.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string', description: 'Caller identity header.' } } },
      body: { type: 'object', additionalProperties: true, description: 'Customer identity payload forwarded by the integration router.' },
      response: {
        200: {
          type: 'object',
          description: 'KYC verification result.',
          properties: {
            verificationStatus: { type: 'string', enum: ['pass', 'fail', 'review'], description: 'Outcome of the identity check.' },
            confidenceScore:    { type: 'number', description: 'Confidence percentage (0–100).' },
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
    return reply.send(verifyKyc(request.body as Record<string, unknown>));
  });

  fastify.get('/config', {
    schema: {
      tags: ['modules:kyc'],
      summary: 'Get KYC module configuration',
      description: 'Returns the active KYC engine configuration.',
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', {
    schema: {
      tags: ['modules:kyc'],
      summary: 'Update KYC module configuration',
      description: 'Replaces the KYC engine configuration. Changes take effect on the next engine invocation.',
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

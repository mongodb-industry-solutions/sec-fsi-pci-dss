// KYC capability module controller — STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { requirePermission } from '../../../vendors/middleware/acl';
import { verifyKyc } from '../services/kyc.service';
import { screenParty } from '../services/hrpScreening.service';
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

  fastify.post('/screen', {
    schema: {
      tags: ['modules:kyc'],
      summary: 'HRP screening engine invocation (internal loopback)',
      description: 'Internal High-Risk-Party (HRP) screening engine. Called by the integration router (ADR-029) '
        + 'for the kyc.screening.requested event when no external screening vendor is active. Produces the '
        + 'deterministic KYC verdict (risk score/rating, PEP, sanctions, provider ref) for a party reference. '
        + 'Not JWT-authenticated; requires `X-Integration-Source` header.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string', description: 'Caller identity header.' } } },
      body: { type: 'object', additionalProperties: true, description: 'Screening payload (carries clientReference / partyInstanceReference).' },
      response: {
        200: {
          type: 'object',
          description: 'HRP screening verdict.',
          properties: {
            riskScore:            { type: 'number', description: 'Risk score 0-100.' },
            riskRating:           { type: 'string', enum: ['low', 'medium', 'high'], description: 'Risk band derived from the score.' },
            pepStatus:            { type: 'boolean', description: 'Politically-exposed-person flag.' },
            sanctionsResult:      { type: 'string', enum: ['clear', 'hit', 'pending'], description: 'Sanctions/watchlist outcome.' },
            screeningProviderRef: { type: 'string', description: 'Screening reference issued by the provider.' },
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
    const body = (request.body ?? {}) as { clientReference?: string; partyInstanceReference?: string };
    const reference = body.clientReference ?? body.partyInstanceReference ?? '';
    return reply.send(screenParty(reference));
  });

  fastify.get('/config', {
    preHandler: requirePermission('modules', 'view'),
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
    preHandler: requirePermission('modules', 'manage'),
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

// VoP capability module controller — STATIC routes (ADR-029).
//   POST /api/v1/modules/vop/verify   — internal engine invocation (endpoint-first loopback)
//   GET/PUT /api/v1/modules/vop/config — admin config of the internal engine
//   GET /api/v1/modules/vop/rules      — effective config preview (drives the admin dashboard)
import { FastifyInstance } from 'fastify';
import { requirePermission } from '../../../vendors/middleware/acl';
import { verifyPayee, resolveVopConfig, VopModuleConfig } from '../services/vop.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';

export async function vopController(fastify: FastifyInstance) {
  const CAP = 'vop';

  // Internal engine — not JWT-authenticated; validated by X-Integration-Source (like FDS/HRP).
  fastify.post('/verify', {
    schema: {
      tags: ['modules:vop'],
      summary: 'VoP engine invocation (internal loopback)',
      description: 'Internal Verification of Payee engine. Called by the integration router (endpoint-first loopback, ADR-029) '
        + 'when no external VoP vendor is active. Not JWT-authenticated; requires `X-Integration-Source` header. '
        + 'Matches the declared payee name against the destination account holder name. Additional to FDS/AML/HRP; market-gated.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string' } } },
      body: { type: 'object', additionalProperties: true, description: 'VoP payload: declaredName, accountHolderName, countryCode, amount.' },
      response: {
        200: {
          type: 'object',
          properties: {
            matchResult: { type: 'string', enum: ['match', 'close_match', 'no_match', 'not_supported'] },
            matchScore: { type: 'number' },
            verifiedName: { type: 'string' },
            decision: { type: 'string', enum: ['block', 'warn', 'pass'] },
            recommendation: { type: 'string' },
          },
        },
        401: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }
    const cfg = await getCapabilityModuleConfig(fastify.db, CAP);
    const moduleConfig = (cfg?.moduleConfig ?? {}) as VopModuleConfig;
    return reply.send(verifyPayee(request.body as Record<string, unknown>, moduleConfig));
  });

  fastify.get('/config', {
    preHandler: requirePermission('modules', 'view'),
    schema: {
      tags: ['modules:vop'],
      summary: 'Get VoP module configuration',
      response: { 200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } } },
    },
  }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  // Effective (resolved) config preview — thresholds + strategy + policy + markets in force.
  fastify.get('/rules', {
    schema: {
      tags: ['modules:vop'],
      summary: 'Get effective VoP configuration (thresholds/strategy/policy/markets)',
      response: { 200: { type: 'object', properties: { capability: { type: 'string' }, rules: { type: 'object', additionalProperties: true } } } },
    },
  }, async () => {
    const cfg = await getCapabilityModuleConfig(fastify.db, CAP);
    return { capability: CAP, rules: resolveVopConfig((cfg?.moduleConfig ?? {}) as VopModuleConfig) };
  });

  fastify.put('/config', {
    preHandler: requirePermission('modules', 'manage'),
    schema: {
      tags: ['modules:vop'],
      summary: 'Update VoP module configuration',
      body: { type: 'object', properties: { moduleConfig: { type: 'object', additionalProperties: true } } },
      response: { 200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } } },
    },
  }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

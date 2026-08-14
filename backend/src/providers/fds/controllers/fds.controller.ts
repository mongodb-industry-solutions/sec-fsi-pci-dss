// FDS capability module controller: STATIC routes (ADR-029): no dynamic catch-all.
//   POST /api/v1/modules/fds/score: internal engine invocation (endpoint-first loopback)
//   GET/PUT /api/v1/modules/fds/config: admin config of the internal engine
import { FastifyInstance } from 'fastify';
import { requirePermission } from '../../../vendors/middleware/acl';
import { scoreFds, resolveFdsRules, FdsModuleConfig } from '../services/fds.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';

export async function fdsController(fastify: FastifyInstance) {
  const CAP = 'fds';

  // Internal engine, not JWT-authenticated; validated by X-Integration-Source (like the old stub).
  fastify.post('/score', {
    schema: {
      tags: ['modules:fds'],
      summary: 'FDS engine invocation (internal loopback)',
      description: 'Internal Fraud Detection System engine. Called by the integration router (endpoint-first loopback, ADR-029) '
        + 'when no external FDS vendor is active. Not JWT-authenticated; requires `X-Integration-Source` header. '
        + 'Evaluates the transaction payload against configured rules and returns a risk score and recommendation.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string', description: 'Caller identity header. Required for all module invocations.' } } },
      body: { type: 'object', additionalProperties: true, description: 'Transaction payload forwarded by the integration router. Fields depend on provider field-mapping rules.' },
      response: {
        200: {
          type: 'object',
          description: 'FDS evaluation result.',
          properties: {
            riskScore:      { type: 'number', description: 'Computed risk score (0–100).' },
            fraudFlag:      { type: 'boolean', description: 'True when recommendation is not `approve`.' },
            recommendation: { type: 'string', enum: ['approve', 'review', 'reject'], description: 'Routing recommendation.' },
            rulesFired:     { type: 'array', items: { type: 'string' }, description: 'Names of rules that fired in this evaluation.' },
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
    // Pass the full module config (rules + shorthands). Back-compat: scoreFds still accepts the legacy
    // { reviewAmount } thresholds shape, so a config that only has `thresholds` keeps working.
    const moduleConfig = (cfg?.moduleConfig ?? {}) as FdsModuleConfig & { thresholds?: { reviewAmount?: number } };
    const effective = moduleConfig.rules || moduleConfig.amount || moduleConfig.riskyMcc || moduleConfig.velocity || moduleConfig.bands
      ? moduleConfig
      : (moduleConfig.thresholds as FdsModuleConfig['amount'] | undefined)
        ? { amount: moduleConfig.thresholds }
        : moduleConfig;
    return reply.send(scoreFds(request.body as Record<string, unknown>, effective));
  });

  // Admin: read / update the internal Module config.
  fastify.get('/config', {
    preHandler: requirePermission('modules', 'view'),
    schema: {
      tags: ['modules:fds'],
      summary: 'Get FDS module configuration',
      description: 'Returns the active FDS engine configuration including scoring rules, amount thresholds, velocity bands, and risky MCC lists.',
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  // Admin: preview the EFFECTIVE rule set currently in force (synthesised from shorthands when no
  // explicit `rules[]` is configured). Drives the built-in rules editor (P13.5).
  fastify.get('/rules', {
    schema: {
      tags: ['modules:fds'],
      summary: 'Get effective FDS rule set',
      description: 'Returns the resolved rule list currently in force. When no explicit `rules[]` array is configured, '
        + 'short-hand settings (amount, velocity, mcc bands) are synthesised into a rule list. '
        + 'This is what the built-in rules editor reads.',
      response: {
        200: {
          type: 'object',
          properties: {
            capability: { type: 'string' },
            rules: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Effective evaluation rule list.' },
          },
        },
      },
    },
  }, async () => {
    const cfg = await getCapabilityModuleConfig(fastify.db, CAP);
    return { capability: CAP, rules: resolveFdsRules((cfg?.moduleConfig ?? {}) as FdsModuleConfig) };
  });

  fastify.put('/config', {
    preHandler: requirePermission('modules', 'manage'),
    schema: {
      tags: ['modules:fds'],
      summary: 'Update FDS module configuration',
      description: 'Replaces the FDS engine configuration. Supports explicit `rules[]` arrays and short-hand properties (amount thresholds, velocity, risky MCC, bands). Changes take effect on the next engine invocation.',
      body: {
        type: 'object',
        properties: {
          moduleConfig: { type: 'object', additionalProperties: true, description: 'Full FDS configuration object. See GET /config for the current shape.' },
        },
      },
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

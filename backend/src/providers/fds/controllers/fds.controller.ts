// FDS capability module controller — STATIC routes (ADR-029): no dynamic catch-all.
//   POST /api/v1/modules/fds/score   — internal engine invocation (endpoint-first loopback)
//   GET/PUT /api/v1/modules/fds/config — admin config of the internal engine
import { FastifyInstance } from 'fastify';
import { scoreFds, resolveFdsRules, FdsModuleConfig } from '../services/fds.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';

export async function fdsController(fastify: FastifyInstance) {
  const CAP = 'fds';

  // Internal engine — not JWT-authenticated; validated by X-Integration-Source (like the old stub).
  fastify.post('/score', {
    schema: {
      tags: ['modules:fds'],
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string' } } },
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
  fastify.get('/config', { schema: { tags: ['modules:fds'] } }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  // Admin: preview the EFFECTIVE rule set currently in force (synthesised from shorthands when no
  // explicit `rules[]` is configured). Drives the built-in rules editor (P13.5).
  fastify.get('/rules', { schema: { tags: ['modules:fds'] } }, async () => {
    const cfg = await getCapabilityModuleConfig(fastify.db, CAP);
    return { capability: CAP, rules: resolveFdsRules((cfg?.moduleConfig ?? {}) as FdsModuleConfig) };
  });

  fastify.put('/config', { schema: { tags: ['modules:fds'] } }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });
}

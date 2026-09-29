import { FastifyInstance } from 'fastify';
import type { AuthenticatedRequest } from '../../../shared/models/identity.model';
import {
  createIntegration,
  getIntegration,
  listIntegrations,
  updateIntegration,
  deleteIntegration,
  rotateKey,
  suspendIntegration,
} from '../services/integrationRegistry.service';
import {
  testIntegration,
  testMapping,
  runIntegrationTest,
  getIntegrationEvents,
} from '../services/integrationDispatch.service';
import {
  platformEnvironment, PLATFORM_ENVIRONMENTS, type PlatformEnvironment,
} from '@leafypay/platform-links';
import { declaredFor, providerBaseUrl, resolveConfiguredUrl } from '../services/providerLink.service';
import type { ExternalProviderArrangement } from '../models/externalProviderArrangement.model';

const E = { type: 'object', properties: { error: { type: 'string' } } };

/**
 * The capability segment the inbound callback route is served under, for a provider's type.
 *
 * Mirrors `GROUP_HANDLER` in the callback controller, which is the thing that actually answers, so a
 * URL shown here is a URL that resolves. The provider type doubles as the segment for the
 * capabilities whose key IS the type; the rest are named because they are not.
 */
const CALLBACK_GROUP: Partial<Record<string, string>> = {
  fraud_detection: 'fds',
  aml_monitoring: 'aml',
  kyc_identity: 'kyc',
  kyb_business: 'kyb',
  hrp_sanctions: 'hrp',
  card_authorization: 'card-authorization',
  card_issuer: 'card-issuer',
};

function callbackGroupFor(providerType: string): string {
  return CALLBACK_GROUP[providerType] ?? 'generic';
}

function isAuthorized(request: AuthenticatedRequest): boolean {
  return request.userRole === 'manager';
}

/**
 * Where this provider's configured paths go, in EVERY environment, with the active one marked.
 *
 * The admin screens used to render the stored value and nothing else, so the four capabilities the
 * bank serves showed `/v1/cards/validations` with a note reading "this points to the PSP internal
 * API; the request will be handled in-process". Both halves were wrong: the path is the bank's, and it
 * is dispatched out of this process to another institution. An operator reading that screen was being
 * told the opposite of what happens.
 *
 * Every environment and not only the running one, because the record declares all of them and the
 * point of declaring them is that they can be reviewed and corrected in one place, before the
 * deployment that would otherwise be the first thing to discover a wrong host. Computed per response
 * rather than stored: a stored copy is one more thing that can disagree with the environment.
 */
function resolvedLinksFor(provider: ExternalProviderArrangement): {
  activeEnvironment: PlatformEnvironment;
  environments: Array<{
    environmentId: PlatformEnvironment;
    active: boolean;
    /** What the record holds for this environment, which may be a platform link name. */
    declared?: string;
    resolved?: string;
    error?: string;
    /** Every configured route, both directions, resolved for this environment. */
    routes: Array<{
      event: string;
      direction: 'outbound' | 'inbound';
      httpMethod?: string;
      path?: string;
      declared?: string;
      resolved?: string;
      error?: string;
    }>;
  }>;
} {
  const activeEnvironment = platformEnvironment();
  const events = provider.externalProviderEvents ?? [];

  const environments = PLATFORM_ENVIRONMENTS.map((environmentId) => {
    const env = { ...process.env, PSP_ENVIRONMENT: environmentId };
    const declared = declaredFor(provider, environmentId);
    let resolved: string | undefined;
    let error: string | undefined;
    try {
      resolved = providerBaseUrl(provider, env);
    } catch (err) {
      error = (err as Error).message;
    }

    const routes = events.flatMap((entry) => {
      const built: Array<{
        event: string; direction: 'outbound' | 'inbound'; httpMethod?: string;
        path?: string; declared?: string; resolved?: string; error?: string;
      }> = [];
      const outbound = entry.outbound;
      if (outbound?.url || outbound?.baseUrlByEnvironment) {
        built.push({
          event: entry.event,
          direction: 'outbound',
          httpMethod: outbound.httpMethod ?? 'POST',
          ...resolveConfiguredUrl(provider, 'outbound', outbound.url, outbound.baseUrlByEnvironment, environmentId, env),
        });
      }
      // The inbound path falls back to the CONVENTIONAL one, which is what the provider is told to
      // call when the record stores nothing. It was derived in the browser from a frontend variable,
      // so the address handed to an external system was assembled somewhere that cannot know the
      // deployment's own hosts. Derived here instead, from the same convention the receiver serves.
      const inbound = entry.inbound;
      const inboundPath = inbound?.callbackUrl
        ?? `/api/v1/providers/${callbackGroupFor(provider.externalProviderArrangementType)}`
          + `/${provider.externalProviderArrangementInstanceReference}`
          + `/${encodeURIComponent(entry.event)}/callback`;
      built.push({
        event: entry.event,
        direction: 'inbound',
        httpMethod: 'POST',
        ...resolveConfiguredUrl(provider, 'inbound', inboundPath, inbound?.baseUrlByEnvironment, environmentId, env),
      });
      return built;
    });

    return { environmentId, active: environmentId === activeEnvironment, declared, resolved, error, routes };
  });

  return { activeEnvironment, environments };
}

export async function integrationRegistryController(fastify: FastifyInstance) {
  // ── GET /integrations ──────────────────────────────────────────────────────
  fastify.get('/', {
    schema: {
      tags: ['providers'],
      summary: 'List all integration providers (SD-193)',
      description: 'Returns all registered external providers (SD-193 External Provider Arrangements). '
        + 'Results can be filtered by `type` (capability, e.g. fraud_detection) and `status` (active | inactive | test). '
        + 'Requires manager role. Each record includes routing config, mode, and current status.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          type:   { type: 'string' },
          status: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', properties: { integrations: { type: 'array' } } },
        403: E,
      },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as AuthenticatedRequest))
        return reply.status(403).send({ error: 'Forbidden: manager or system_admin role required' });

      const { type, status } = request.query as { type?: string; status?: string };
      const integrations = await listIntegrations(fastify.db, { type: type as never, status });
      return { integrations };
    },
  });

  // ── POST /integrations ─────────────────────────────────────────────────────
  fastify.post('/', {
    schema: {
      tags: ['providers'],
      summary: 'Register a new integration provider (SD-193)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['externalProviderArrangementName', 'externalProviderArrangementType', 'externalProviderMode'],
        properties: {
          externalProviderArrangementName:   { type: 'string', minLength: 1 },
          externalProviderArrangementType:   { type: 'string', enum: ['fraud_detection','aml_monitoring','kyc_identity','kyb_business','hrp_sanctions','credit_bureau','generic'] },
          externalProviderApiEndpoint:       { type: 'string' },
          externalProviderArrangementStatus: { type: 'string', enum: ['active','inactive','test'] },
          externalProviderMode:              { type: 'string', enum: ['sync','async'] },
          externalProviderCallbackUrl:       { type: 'string' },
          externalProviderTimeoutMs:         { type: 'number', minimum: 100, maximum: 30000 },
          categoryConfig:                    { type: 'object' },
          authConfig:                        { type: 'object' },
          fieldMappingConfig:                { type: 'object' },
          routingGroupId:                    { type: 'string' },
          routingPriority:                   { type: 'number' },
          routingWeight:                     { type: 'number' },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true },
        403: E,
        409: E,
        422: E,
      },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as AuthenticatedRequest))
        return reply.status(403).send({ error: 'Forbidden: manager or system_admin role required' });

      try {
        const body = request.body as Record<string, unknown>;
        const result = await createIntegration(fastify.db, {
          name:            body.externalProviderArrangementName as string,
          type:            body.externalProviderArrangementType as never,
          mode:            body.externalProviderMode as never,
          endpoint:        body.externalProviderApiEndpoint as string | undefined,
          callbackSecret:  body.externalProviderCallbackUrl as string | undefined,
          triggerEvents:   (body.externalProviderTriggerEvents as string[] | undefined) ?? [],
          timeoutMs:       body.externalProviderTimeoutMs as number | undefined,
          initialStatus:   body.externalProviderArrangementStatus as never,
          categoryConfig:  body.categoryConfig as never,
          authConfig:      body.authConfig as never,
          fieldMappingConfig: body.fieldMappingConfig as never,
          routingGroupId:  body.routingGroupId as string | undefined,
          routingPriority: body.routingPriority as number | undefined,
          routingWeight:   body.routingWeight as number | undefined,
        });
        return reply.status(201).send(result);
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code === 409) return reply.status(409).send({ error: 'A provider with this type and endpoint already exists' });
        if (code === 422) return reply.status(422).send({ error: (err as Error).message });
        throw err;
      }
    },
  });

  // ── GET /integrations/:id ──────────────────────────────────────────────────
  fastify.get('/:id', {
    schema: {
      tags: ['providers'],
      summary: 'Get integration provider detail',
      description: 'Returns the full configuration of a single external provider, including endpoint, '
        + 'authConfig, fieldMappingConfig, routing group, timeout, retry policy, and current status. '
        + 'The `externalProviderApiKey` field is never returned. Requires manager role.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as AuthenticatedRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      const integration = await getIntegration(fastify.db, id);
      if (!integration) return reply.status(404).send({ error: 'Integration not found' });
      // The record NAMES its links; the admin screens have to show the address this environment will
      // actually dial, and they cannot resolve it themselves (the resolution reads this process's
      // environment, and these are browser-rendered pages). Computed per response rather than stored,
      // because a stored copy would be one more thing that can disagree with the environment.
      return { integration, links: resolvedLinksFor(integration) };
    },
  });

  // ── PATCH /integrations/:id ────────────────────────────────────────────────
  fastify.patch('/:id', {
    schema: {
      tags: ['providers'],
      summary: 'Update integration provider configuration',
      description: 'Partially updates a provider\'s configuration. All body fields are optional; '
        + 'only the fields provided are changed. Changing `externalProviderArrangementStatus` to `inactive` '
        + 'stops the routing engine from dispatching new events to this provider. '
        + 'Changing `fieldMappingConfig` takes effect immediately for the next event. Requires manager role.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          externalProviderApiEndpoint:       { type: 'string' },
          // The provider's address per environment. `additionalProperties` rather than an enum of the
          // three names, because an unknown key must be REPORTED by the resolver (which names the
          // valid ones) and not silently dropped by the schema before anyone sees it.
          externalProviderBaseUrlByEnvironment: { type: 'object', additionalProperties: { type: 'string' } },
          externalProviderTriggerEvents:     { type: 'array', items: { type: 'string' } },
          externalProviderEvents:            { type: 'array', items: { type: 'object', additionalProperties: true } },
          externalProviderMode:              { type: 'string', enum: ['sync','async'] },
          externalProviderTimeoutMs:         { type: 'number', minimum: 100, maximum: 30000 },
          externalProviderRetryPolicy:       { type: 'object' },
          externalProviderArrangementStatus: { type: 'string', enum: ['active','inactive','test'] },
          externalProviderCallbackEnabled:   { type: 'boolean' },
          externalProviderCallbackPath:      { type: 'string' },
          categoryConfig:                    { type: 'object' },
          authConfig:                        { type: 'object' },
          fieldMappingConfig:                { type: 'object' },
          routingGroupId:                    { type: 'string' },
          routingPriority:                   { type: 'number' },
          routingWeight:                     { type: 'number' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E, 422: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as AuthenticatedRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;

      /**
       * Copied field by field, so a body key that is not updateable cannot reach the database.
       *
       * The list has to be kept in step with `UpdateablePatch`, and it was not: `externalProviderEvents`
       * was declared updateable, accepted by the schema, sent by the outbound and inbound screens on
       * every save, and dropped here. The request answered 200 with the record unchanged, so every
       * per-event edit an operator made was discarded while the UI reported success. The same omission
       * swallowed the per-environment base URLs. Anything added to `UpdateablePatch` belongs here too.
       */
      const patch: Parameters<typeof updateIntegration>[2] = {};
      if (body.externalProviderApiEndpoint !== undefined)       patch.externalProviderApiEndpoint   = body.externalProviderApiEndpoint as string;
      if (body.externalProviderBaseUrlByEnvironment !== undefined) patch.externalProviderBaseUrlByEnvironment = body.externalProviderBaseUrlByEnvironment as never;
      if (body.externalProviderEvents !== undefined)            patch.externalProviderEvents        = body.externalProviderEvents as never;
      if (body.externalProviderTriggerEvents !== undefined)     patch.externalProviderTriggerEvents = body.externalProviderTriggerEvents as string[];
      if (body.externalProviderMode !== undefined)              patch.externalProviderMode          = body.externalProviderMode as never;
      if (body.externalProviderTimeoutMs !== undefined)         patch.externalProviderTimeoutMs     = body.externalProviderTimeoutMs as number;
      if (body.externalProviderRetryPolicy !== undefined)       patch.externalProviderRetryPolicy   = body.externalProviderRetryPolicy as never;
      if (body.externalProviderArrangementStatus !== undefined) patch.externalProviderArrangementStatus = body.externalProviderArrangementStatus as never;
      if (body.externalProviderCallbackEnabled !== undefined)   patch.externalProviderCallbackEnabled = body.externalProviderCallbackEnabled as boolean;
      if (body.externalProviderCallbackPath !== undefined)      patch.externalProviderCallbackPath  = body.externalProviderCallbackPath as string;
      if (body.categoryConfig !== undefined)                    patch.categoryConfig  = body.categoryConfig as never;
      if (body.authConfig !== undefined)                        patch.authConfig      = body.authConfig as never;
      if (body.fieldMappingConfig !== undefined)                patch.fieldMappingConfig = body.fieldMappingConfig as never;
      if (body.routingGroupId !== undefined)                    patch.routingGroupId  = body.routingGroupId as string;
      if (body.routingPriority !== undefined)                   patch.routingPriority = body.routingPriority as number;
      if (body.routingWeight !== undefined)                     patch.routingWeight   = body.routingWeight as number;

      try {
        const integration = await updateIntegration(fastify.db, id, patch);
        if (!integration) return reply.status(404).send({ error: 'Integration not found' });
        return { integration };
      } catch (err) {
        if ((err as { code?: number }).code === 422) return reply.status(422).send({ error: (err as Error).message });
        throw err;
      }
    },
  });

  // ── POST /integrations/:id/rotate-key ──────────────────────────────────────
  fastify.post('/:id/rotate-key', {
    schema: {
      tags: ['providers'],
      summary: 'Rotate integration API / webhook signing key',
      description: 'Generates a new HMAC-SHA256 signing secret for the provider\'s webhook callbacks. '
        + 'The new key is returned once in the response and stored hashed; it cannot be retrieved again. '
        + 'The provider must be updated with the new key before rotation to avoid validation failures. '
        + 'Returns 400 if the provider does not have a key to rotate. Requires manager role.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: E, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as AuthenticatedRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      try {
        const result = await rotateKey(fastify.db, id);
        if (!result) return reply.status(404).send({ error: 'Integration not found' });
        return result;
      } catch (err) {
        if ((err as { code?: number }).code === 400) return reply.status(400).send({ error: (err as Error).message });
        throw err;
      }
    },
  });

  // ── POST /integrations/:id/test ─────────────────────────────────────────────
  fastify.post('/:id/test', {
    schema: {
      tags: ['providers'],
      summary: 'Test integration provider connectivity',
      description: 'Sends a lightweight ping request to the provider\'s configured endpoint and '
        + 'returns the HTTP status and measured round-trip latency. '
        + 'Does NOT record an integration event or trigger field-mapping. '
        + 'Use `POST /:id/run-test` to perform a real dispatched test that records an event. '
        + 'Requires manager role.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { status: { type: 'string' }, latencyMs: { type: 'number' } } }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as AuthenticatedRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      try {
        return await testIntegration(fastify.db, id);
      } catch (err) {
        if ((err as { code?: number }).code === 404) return reply.status(404).send({ error: 'Integration not found' });
        throw err;
      }
    },
  });

  // ── POST /integrations/:id/test-mapping ────────────────────────────────────
  fastify.post('/:id/test-mapping', {
    schema: {
      tags: ['providers'],
      summary: 'Dry-run field mapping rules against a sample payload',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['direction', 'payload'],
        properties: {
          direction: { type: 'string', enum: ['outbound', 'inbound'] },
          payload:   { type: 'object' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as AuthenticatedRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      const { direction, payload } = request.body as { direction: 'outbound' | 'inbound'; payload: Record<string, unknown> };
      try {
        return await testMapping(fastify.db, id, direction, payload);
      } catch (err) {
        if ((err as { code?: number }).code === 404) return reply.status(404).send({ error: 'Integration not found' });
        throw err;
      }
    },
  });

  // ── POST /integrations/:id/run-test ────────────────────────────────────────
  // Real execution (vs test-mapping which only transforms). Records an integrationEvent.
  fastify.post('/:id/run-test', {
    schema: {
      tags: ['providers'],
      summary: 'Run a real inbound/outbound test (records an event)',
      description: 'Outbound: POSTs the mapped payload to the override URL or configured endpoint. Inbound: applies inbound mapping and records a callback event. Manager only.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['direction', 'payload'],
        properties: {
          direction:   { type: 'string', enum: ['outbound', 'inbound'] },
          payload:     { type: 'object' },
          overrideUrl: { type: 'string' },
          // Which event's config to test. Outbound config is per event, so without this the test
          // ran against whichever one happened to be first and reported a result for another route.
          eventName:   { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as AuthenticatedRequest))
        return reply.status(403).send({ error: 'Forbidden' });
      const { id } = request.params as { id: string };
      const { direction, payload, overrideUrl, eventName } = request.body as {
        direction: 'outbound' | 'inbound'; payload: Record<string, unknown>;
        overrideUrl?: string; eventName?: string;
      };
      try {
        return await runIntegrationTest(fastify.db, id, direction, payload, overrideUrl, eventName);
      } catch (err) {
        if ((err as { code?: number }).code === 404) return reply.status(404).send({ error: 'Integration not found' });
        throw err;
      }
    },
  });

  // ── POST /integrations/:id/suspend ──────────────────────────────────────────
  fastify.post('/:id/suspend', {
    schema: {
      tags: ['providers'],
      summary: 'Suspend an integration provider',
      description: 'Sets the provider\'s status to `inactive`, stopping the routing engine from '
        + 'dispatching new events to it. Existing in-flight events are unaffected. '
        + 'To re-activate, use PATCH /:id with `externalProviderArrangementStatus: "active"`. '
        + 'Returns 400 if the provider is already inactive. Requires manager role.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: E, 403: E, 404: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as AuthenticatedRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      try {
        const integration = await suspendIntegration(fastify.db, id);
        if (!integration) return reply.status(404).send({ error: 'Integration not found' });
        return { integration };
      } catch (err) {
        if ((err as { code?: number }).code === 400) return reply.status(400).send({ error: (err as Error).message });
        throw err;
      }
    },
  });

  // ── DELETE /integrations/providers/:id ────────────────────────────────────
  fastify.delete('/:id', {
    schema: {
      tags: ['providers'],
      summary: 'Delete an external integration provider',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: {
        200: { type: 'object', properties: { deleted: { type: 'boolean' } } },
        400: E, 403: E, 404: E,
      },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as AuthenticatedRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      try {
        const deleted = await deleteIntegration(fastify.db, id);
        if (!deleted) return reply.status(404).send({ error: 'Integration not found' });
        return { deleted: true };
      } catch (err) {
        if ((err as { code?: number }).code === 400) return reply.status(400).send({ error: (err as Error).message });
        throw err;
      }
    },
  });

  // ── GET /integrations/:id/events ────────────────────────────────────────────
  fastify.get('/:id/events', {
    schema: {
      tags: ['providers'],
      summary: 'Get integration event log (paginated)',
      description: 'Returns the dispatch and callback event history for a provider, in reverse chronological order. '
        + 'Each event records the request/response payload, mapped fields, HTTP status, latency, and outcome. '
        + 'Use this to audit provider behavior, debug field-mapping rules, or review callback delivery. '
        + 'Supports `page` and `limit` query parameters. Requires manager role.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      querystring: {
        type: 'object',
        properties: {
          page:      { type: 'string' },
          limit:     { type: 'string' },
          // Direction is the filter an audit reaches for first: "are this provider's callbacks
          // arriving" is unanswerable from a list that interleaves both and labels neither.
          direction: { type: 'string', enum: ['outbound', 'inbound'] },
          type:      { type: 'string', enum: ['dispatch', 'callback', 'health_check', 'test'] },
          status:    { type: 'string', enum: ['sent', 'received', 'error', 'timeout'] },
          from:      { type: 'string' },
          to:        { type: 'string' },
          q:         { type: 'string' },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 403: E },
    },
    handler: async (request, reply) => {
      if (!isAuthorized(request as unknown as AuthenticatedRequest))
        return reply.status(403).send({ error: 'Forbidden' });

      const { id } = request.params as { id: string };
      const { page, limit, ...filters } = request.query as {
        page?: string; limit?: string;
        direction?: 'outbound' | 'inbound';
        type?: 'dispatch' | 'callback' | 'health_check' | 'test';
        status?: 'sent' | 'received' | 'error' | 'timeout';
        from?: string; to?: string; q?: string;
      };
      // Capped, because this endpoint also backs the evidence export and an uncapped limit is an
      // unbounded response on a timeseries collection.
      const requested = parseInt(limit ?? '20');
      const bounded = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 500) : 20;
      return getIntegrationEvents(fastify.db, id, parseInt(page ?? '1'), bounded, filters);
    },
  });
}

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  INTEGRATION_EVENTS_COLLECTION,
  IntegrationEvent,
  IntegrationProviderType,
  ExternalProviderArrangement,
  IntegrationRoutingGroup,
  INTEGRATION_ROUTING_GROUPS_COLLECTION,
  BusinessContextRef,
} from '../models/externalProviderArrangement.model';
import {
  getActiveProviderForType,
  updateHealthStatus,
  hashPayload,
} from './integrationRegistry.service';
import { applyMappings } from './fieldMapping.service';
import { resolveProviderFromGroup } from './integrationRoutingGroup.service';
import { sanitizeDeep } from './businessProcessEvent.service';

export interface DispatchResult {
  provider: 'internal' | 'external';
  arrangementId: string;
  status: 'sent' | 'received' | 'error' | 'timeout';
  latencyMs: number;
  responseCode?: number;
  error?: string;
}

export async function dispatchIntegration(
  db: Db,
  type: IntegrationProviderType,
  triggeredBy: string,
  payload: Record<string, unknown>,
  businessContext?: BusinessContextRef
): Promise<DispatchResult> {
  const provider = await getActiveProviderForType(db, type);

  if (!provider) {
    return {
      provider: 'internal',
      arrangementId: '',
      status: 'error',
      latencyMs: 0,
      error: `No active provider for type ${type}`,
    };
  }

  // If provider belongs to a routing group, resolve the best member
  if (provider.routingGroupId && !provider.externalProviderIsInternal) {
    const group = await db.collection<IntegrationRoutingGroup>(INTEGRATION_ROUTING_GROUPS_COLLECTION)
      .findOne({ routingGroupInstanceReference: provider.routingGroupId });
    if (group) {
      const resolved = await resolveProviderFromGroup(db, group);
      if (resolved) {
        // ADR-025: endpoint-first — if resolved provider has an endpoint, dispatch externally
        if (resolved.externalProviderApiEndpoint) {
          return dispatchExternal(db, resolved, triggeredBy, payload, businessContext);
        }
        return logAndReturn(db, resolved, triggeredBy, payload, businessContext, {
          provider: 'internal',
          arrangementId: resolved.externalProviderArrangementInstanceReference,
          status: 'sent',
          latencyMs: 0,
        });
      }
    }
  }

  // ADR-025: endpoint-first dispatch logic
  // Internal providers WITH an endpoint make a real HTTP call (enables loopback to /api/v1/internal/*)
  if (provider.externalProviderApiEndpoint) {
    return dispatchExternal(db, provider, triggeredBy, payload, businessContext);
  }

  // Pure stub: internal provider with no endpoint configured
  return logAndReturn(db, provider, triggeredBy, payload, businessContext, {
    provider: 'internal',
    arrangementId: provider.externalProviderArrangementInstanceReference,
    status: 'sent',
    latencyMs: 0,
  });
}

function buildAuthHeaders(provider: ExternalProviderArrangement): Record<string, string> {
  if (!provider.authConfig) {
    return { 'X-Integration-Source': 'leafybank-demo' };
  }

  const { scheme, bearer, apiKey } = provider.authConfig;

  if (scheme === 'bearer' && bearer) {
    // API key is bcrypt-hashed — we can't recover the plaintext in a demo.
    // In production, the plaintext key would be in AWS Secrets Manager.
    const headerName = bearer.tokenHeaderName ?? 'Authorization';
    const prefix = bearer.tokenPrefix ?? 'Bearer';
    return {
      [headerName]: `${prefix} [demo-key-placeholder]`,
      'X-Integration-Source': 'leafybank-demo',
    };
  }

  if (scheme === 'api_key' && apiKey) {
    if (apiKey.keyLocation === 'header') {
      const headerName = apiKey.keyHeaderName ?? 'X-API-Key';
      const prefix = apiKey.keyPrefix ?? '';
      return {
        [headerName]: `${prefix}[demo-key-placeholder]`,
        'X-Integration-Source': 'leafybank-demo',
      };
    }
  }

  return { 'X-Integration-Source': 'leafybank-demo' };
}

async function dispatchExternal(
  db: Db,
  provider: ExternalProviderArrangement,
  triggeredBy: string,
  payload: Record<string, unknown>,
  businessContext?: BusinessContextRef
): Promise<DispatchResult> {
  const start = Date.now();
  const arrangementId = provider.externalProviderArrangementInstanceReference;

  // Apply outbound field mapping before sending
  const mappedPayload = provider.fieldMappingConfig?.outbound?.length
    ? applyMappings(payload, provider.fieldMappingConfig.outbound)
    : payload;

  const fieldMappingApplied = mappedPayload !== payload;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(provider),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), provider.externalProviderTimeoutMs);

    const res = await fetch(provider.externalProviderApiEndpoint!, {
      method: 'POST',
      headers,
      body: JSON.stringify(mappedPayload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    const status = res.ok ? 'received' : 'error';

    await logEvent(db, {
      arrangementId,
      type: 'dispatch',
      status,
      triggeredBy,
      payload: mappedPayload,
      responseCode: res.status,
      latencyMs,
      meta: { fieldMappingApplied },
      businessContext,
    });

    await updateHealthStatus(db, arrangementId, res.ok ? 'ok' : 'degraded');

    return { provider: 'external', arrangementId, status, latencyMs, responseCode: res.status };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isTimeout = (err as Error).name === 'AbortError';
    const status = isTimeout ? 'timeout' : 'error';

    await logEvent(db, {
      arrangementId,
      type: 'dispatch',
      status,
      triggeredBy,
      payload: mappedPayload,
      latencyMs,
      error: (err as Error).message,
      meta: { fieldMappingApplied },
      businessContext,
    });

    await updateHealthStatus(db, arrangementId, 'unreachable');

    return { provider: 'external', arrangementId, status, latencyMs, error: (err as Error).message };
  }
}

async function logAndReturn(
  db: Db,
  provider: ExternalProviderArrangement,
  triggeredBy: string,
  payload: Record<string, unknown>,
  businessContext: BusinessContextRef | undefined,
  result: DispatchResult
): Promise<DispatchResult> {
  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'dispatch',
    status: result.status,
    triggeredBy,
    payload,
    latencyMs: result.latencyMs,
    businessContext,
  });
  return result;
}

export async function logEvent(
  db: Db,
  opts: {
    arrangementId: string;
    type: IntegrationEvent['integrationEventType'];
    status: IntegrationEvent['integrationEventStatus'];
    triggeredBy: string;
    payload?: Record<string, unknown>;
    responseCode?: number;
    latencyMs?: number;
    error?: string;
    meta?: Record<string, unknown>;
    businessContext?: BusinessContextRef;
  }
): Promise<void> {
  const event: IntegrationEvent = {
    integrationEventInstanceReference: uuidv4(),
    externalProviderArrangementInstanceReference: opts.arrangementId,
    integrationEventType: opts.type,
    integrationEventStatus: opts.status,
    integrationEventPayloadHash: opts.payload ? hashPayload(opts.payload) : undefined,
    integrationEventPayloadSnapshot: opts.payload ? (sanitizeDeep(opts.payload) as Record<string, unknown>) : undefined,
    integrationEventResponseCode: opts.responseCode,
    integrationEventLatencyMs: opts.latencyMs,
    integrationEventErrorMessage: opts.error,
    integrationEventTriggeredBy: opts.triggeredBy,
    integrationEventMeta: opts.meta,
    businessContext: opts.businessContext,
    bianServiceDomain: 'External Provider Arrangements',
    bianControlRecordType: 'ExternalProviderArrangementActionLog',
    recordCreatedDateTime: new Date(),
  };

  void db.collection<IntegrationEvent>(INTEGRATION_EVENTS_COLLECTION).insertOne(event).catch(() => {});
}

export async function testIntegration(
  db: Db,
  id: string
): Promise<{ status: 'ok' | 'error' | 'timeout'; latencyMs: number; responseCode?: number }> {
  const { getIntegration } = await import('./integrationRegistry.service');
  const provider = await getIntegration(db, id);

  if (!provider) throw Object.assign(new Error('Integration not found'), { code: 404 });

  if (provider.externalProviderIsInternal) {
    await logEvent(db, { arrangementId: id, type: 'test', status: 'received', triggeredBy: 'system_admin.test', latencyMs: 0 });
    await updateHealthStatus(db, id, 'ok');
    return { status: 'ok', latencyMs: 0 };
  }

  if (!provider.externalProviderApiEndpoint) {
    return { status: 'error', latencyMs: 0 };
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), provider.externalProviderTimeoutMs ?? 5000);
    const res = await fetch(provider.externalProviderApiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Integration-Test': 'true' },
      body: JSON.stringify({ test: true, source: 'leafybank-demo' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const status = res.ok ? 'ok' : 'error';

    await logEvent(db, { arrangementId: id, type: 'test', status: res.ok ? 'received' : 'error', triggeredBy: 'system_admin.test', latencyMs, responseCode: res.status });
    await updateHealthStatus(db, id, res.ok ? 'ok' : 'degraded');

    return { status, latencyMs, responseCode: res.status };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isTimeout = (err as Error).name === 'AbortError';
    const status = isTimeout ? 'timeout' : 'error';

    await logEvent(db, { arrangementId: id, type: 'test', status: isTimeout ? 'timeout' : 'error', triggeredBy: 'system_admin.test', latencyMs, error: (err as Error).message });
    await updateHealthStatus(db, id, 'unreachable');

    return { status, latencyMs };
  }
}

export async function testMapping(
  db: Db,
  id: string,
  direction: 'outbound' | 'inbound',
  payload: Record<string, unknown>
): Promise<{ original: Record<string, unknown>; transformed: Record<string, unknown>; appliedRules: number; errors: string[] }> {
  const { getIntegration } = await import('./integrationRegistry.service');
  const provider = await getIntegration(db, id);
  if (!provider) throw Object.assign(new Error('Integration not found'), { code: 404 });

  const rules = direction === 'outbound'
    ? (provider.fieldMappingConfig?.outbound ?? [])
    : (provider.fieldMappingConfig?.inbound ?? []);

  const errors: string[] = [];
  let transformed = payload;

  try {
    transformed = applyMappings(payload, rules);
  } catch (err) {
    errors.push((err as Error).message);
  }

  return {
    original: payload,
    transformed,
    appliedRules: rules.length,
    errors,
  };
}

// Resolve a possibly-relative URL to absolute, against this server's own base, so an
// internal PSP override (e.g. /api/v1/webhooks/{id}/callback) can be reached over loopback.
function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = process.env.SELF_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`;
  return base.replace(/\/$/, '') + (url.startsWith('/') ? url : `/${url}`);
}

export interface RunTestResult {
  direction: 'outbound' | 'inbound';
  executed: boolean;
  status: IntegrationEvent['integrationEventStatus'];
  latencyMs: number;
  responseCode?: number;
  responseBody?: unknown;
  transformed: Record<string, unknown>;
  appliedRules: number;
  targetUrl?: string;
  error?: string;
}

// Read a response body for the test result, parsing JSON when possible and truncating
// large text so the audit/preview stays readable. Best-effort; never throws.
async function readResponseBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return undefined;
    try { return JSON.parse(text); } catch { return text.length > 4000 ? `${text.slice(0, 4000)}…` : text; }
  } catch { return undefined; }
}

// "Run Test" — a REAL execution (distinct from test-mapping/Validate Params which only
// transforms). Outbound: applies outbound mapping and POSTs to the override URL or the
// configured endpoint, recording an integrationEvent. Inbound: applies inbound mapping and
// records a callback event, mirroring real reception. Results surface in the events stream.
export async function runIntegrationTest(
  db: Db,
  id: string,
  direction: 'outbound' | 'inbound',
  payload: Record<string, unknown>,
  overrideUrl?: string
): Promise<RunTestResult> {
  const { getIntegration } = await import('./integrationRegistry.service');
  const provider = await getIntegration(db, id);
  if (!provider) throw Object.assign(new Error('Integration not found'), { code: 404 });

  const rules = direction === 'outbound'
    ? (provider.fieldMappingConfig?.outbound ?? [])
    : (provider.fieldMappingConfig?.inbound ?? []);
  let transformed = payload;
  try { transformed = applyMappings(payload, rules); } catch { /* keep original on mapping error */ }

  if (direction === 'inbound') {
    await logEvent(db, {
      arrangementId: id,
      type: 'callback',
      status: 'received',
      triggeredBy: 'manager.run-test.inbound',
      payload: transformed,
      latencyMs: 0,
      meta: { test: true, direction: 'inbound' },
    });
    return { direction, executed: true, status: 'received', latencyMs: 0, transformed, appliedRules: rules.length };
  }

  // outbound — real HTTP dispatch to the override URL or the configured endpoint
  const rawTarget = overrideUrl?.trim() || provider.externalProviderApiEndpoint;
  if (!rawTarget) {
    return { direction, executed: false, status: 'error', latencyMs: 0, transformed, appliedRules: rules.length, error: 'No endpoint configured and no override URL provided.' };
  }
  const targetUrl = toAbsoluteUrl(rawTarget);
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), provider.externalProviderTimeoutMs ?? 5000);
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Integration-Test': 'true', ...buildAuthHeaders(provider) },
      body: JSON.stringify(transformed),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const status = res.ok ? 'received' : 'error';
    const responseBody = await readResponseBody(res);
    await logEvent(db, {
      arrangementId: id, type: 'test', status, triggeredBy: 'manager.run-test.outbound',
      payload: transformed, responseCode: res.status, latencyMs,
      meta: { test: true, direction: 'outbound', targetUrl, override: !!overrideUrl, responseBody },
    });
    await updateHealthStatus(db, id, res.ok ? 'ok' : 'degraded');
    return { direction, executed: true, status, latencyMs, responseCode: res.status, responseBody, transformed, appliedRules: rules.length, targetUrl };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isTimeout = (err as Error).name === 'AbortError';
    await logEvent(db, {
      arrangementId: id, type: 'test', status: isTimeout ? 'timeout' : 'error', triggeredBy: 'manager.run-test.outbound',
      payload: transformed, latencyMs, error: (err as Error).message,
      meta: { test: true, direction: 'outbound', targetUrl, override: !!overrideUrl },
    });
    await updateHealthStatus(db, id, 'unreachable');
    return { direction, executed: true, status: isTimeout ? 'timeout' : 'error', latencyMs, transformed, appliedRules: rules.length, targetUrl, error: (err as Error).message };
  }
}

export async function getIntegrationEvents(
  db: Db,
  arrangementId: string,
  page = 1,
  limit = 20
): Promise<{ events: IntegrationEvent[]; total: number }> {
  const col = db.collection<IntegrationEvent>(INTEGRATION_EVENTS_COLLECTION);
  const query = { externalProviderArrangementInstanceReference: arrangementId };
  const [events, total] = await Promise.all([
    col.find(query).sort({ recordCreatedDateTime: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(query),
  ]);
  return { events, total };
}

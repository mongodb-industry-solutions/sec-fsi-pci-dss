import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  INTEGRATION_EVENTS_COLLECTION,
  IntegrationEvent,
  IntegrationProviderType,
  ExternalProviderArrangement,
  IntegrationRoutingGroup,
  INTEGRATION_ROUTING_GROUPS_COLLECTION,
} from '../models/externalProviderArrangement.model';
import {
  getActiveProviderForType,
  updateHealthStatus,
  hashPayload,
} from './integrationRegistry.service';
import { applyMappings } from './fieldMapping.service';
import { resolveProviderFromGroup } from './integrationRoutingGroup.service';

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
  payload: Record<string, unknown>
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
        return resolved.externalProviderIsInternal
          ? logAndReturn(db, resolved, triggeredBy, payload, { provider: 'internal', arrangementId: resolved.externalProviderArrangementInstanceReference, status: 'sent', latencyMs: 0 })
          : dispatchExternal(db, resolved, triggeredBy, payload);
      }
    }
  }

  if (provider.externalProviderIsInternal) {
    return logAndReturn(db, provider, triggeredBy, payload, {
      provider: 'internal',
      arrangementId: provider.externalProviderArrangementInstanceReference,
      status: 'sent',
      latencyMs: 0,
    });
  }

  return dispatchExternal(db, provider, triggeredBy, payload);
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
  payload: Record<string, unknown>
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
  result: DispatchResult
): Promise<DispatchResult> {
  await logEvent(db, {
    arrangementId: provider.externalProviderArrangementInstanceReference,
    type: 'dispatch',
    status: result.status,
    triggeredBy,
    payload,
    latencyMs: result.latencyMs,
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
  }
): Promise<void> {
  const event: IntegrationEvent = {
    integrationEventInstanceReference: uuidv4(),
    externalProviderArrangementInstanceReference: opts.arrangementId,
    integrationEventType: opts.type,
    integrationEventStatus: opts.status,
    integrationEventPayloadHash: opts.payload ? hashPayload(opts.payload) : undefined,
    integrationEventResponseCode: opts.responseCode,
    integrationEventLatencyMs: opts.latencyMs,
    integrationEventErrorMessage: opts.error,
    integrationEventTriggeredBy: opts.triggeredBy,
    integrationEventMeta: opts.meta,
    bianServiceDomain: 'External Provider Arrangements',
    bianControlRecordType: 'ExternalProviderArrangementActionLog',
    recordCreatedDateTime: new Date(),
  };

  await db.collection<IntegrationEvent>(INTEGRATION_EVENTS_COLLECTION).insertOne(event);
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

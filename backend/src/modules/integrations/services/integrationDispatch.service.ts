import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  INTEGRATION_EVENTS_COLLECTION,
  IntegrationEvent,
  IntegrationProviderType,
  ExternalProviderArrangement,
} from '../models/externalProviderArrangement.model';
import {
  getActiveProviderForType,
  updateHealthStatus,
  hashPayload,
} from './integrationRegistry.service';

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

  // Always use the active provider (could be internal or external)
  if (!provider) {
    return {
      provider: 'internal',
      arrangementId: '',
      status: 'error',
      latencyMs: 0,
      error: `No active provider for type ${type}`,
    };
  }

  if (provider.externalProviderIsInternal) {
    return logAndReturn(db, provider, triggeredBy, payload, {
      provider: 'internal',
      arrangementId: provider.externalProviderArrangementInstanceReference,
      status: 'sent',
      latencyMs: 0,
    });
  }

  // External provider — HTTP dispatch
  return dispatchExternal(db, provider, triggeredBy, payload);
}

async function dispatchExternal(
  db: Db,
  provider: ExternalProviderArrangement,
  triggeredBy: string,
  payload: Record<string, unknown>
): Promise<DispatchResult> {
  const start = Date.now();
  const arrangementId = provider.externalProviderArrangementInstanceReference;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (provider.externalProviderAuthScheme === 'bearer' || provider.externalProviderAuthScheme === 'api_key') {
      // The API key hash is stored; we cannot reconstruct the plaintext key here.
      // External dispatch uses the stored prefix for identification only.
      // In a real implementation, the plaintext key would be stored securely (e.g., AWS Secrets Manager).
      headers['X-Integration-Source'] = 'leafybank-demo';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), provider.externalProviderTimeoutMs);

    const res = await fetch(provider.externalProviderApiEndpoint!, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
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
      payload,
      responseCode: res.status,
      latencyMs,
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
      payload,
      latencyMs,
      error: (err as Error).message,
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
  }
): Promise<void> {
  const bianMeta = {
    bianServiceDomain: 'External Provider Arrangements',
    bianControlRecordType: 'ExternalProviderArrangementActionLog',
  };

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
    ...bianMeta,
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

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  EXTERNAL_PROVIDER_ARRANGEMENT_ACTION_LOG_COLLECTION,
  IntegrationEvent,
  IntegrationProviderType,
  ExternalProviderArrangement,
  IntegrationRoutingGroup,
  EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION,
  BusinessContextRef,
  IntegrationAuthConfig,
} from '../models/externalProviderArrangement.model';
import {
  getActiveProviderForType,
  updateHealthStatus,
  hashPayload,
} from './integrationRegistry.service';
import { applyMappings } from './fieldMapping.service';
import { resolveProviderFromGroup } from './integrationRoutingGroup.service';
import {
  resolveProvider, resolverKindFor, isEntityBound,
  type ResolutionContext, type EntityBoundProviderType, type StrategyBoundProviderType,
} from './resolverStrategy';
import { getProviderAccessToken } from './providerAccessToken.service';
import { sanitizeDeep } from './businessProcessEvent.service';
import { resolveEventOutbound, resolveEventInbound } from './providerEventConfig.service';

export interface DispatchResult {
  provider: 'internal' | 'external';
  arrangementId: string;
  status: 'sent' | 'received' | 'error' | 'timeout';
  latencyMs: number;
  responseCode?: number;
  error?: string;
  // Parsed body the provider/module returned. Lets the caller act on the provider's DECISION (e.g.
  // a card issuer that approves/declines), not just on transport success. Undefined for stub
  // providers with no endpoint, or when the call errored/timed out before a body was read.
  responseBody?: unknown;
}

/**
 * Substitutes `{placeholder}` segments in a configured URL from the payload.
 *
 * Returns which keys were consumed so the caller can keep them out of the body. A placeholder with no
 * matching field is left as-is rather than blanked: a URL with a visible `{accountId}` in it fails loudly at
 * the provider, whereas silently producing `/v1/accounts//balances` would read as a routing bug for hours.
 */
export function applyPathTemplate(
  url: string,
  payload: Record<string, unknown>,
): { url: string; consumed: string[] } {
  if (!url.includes('{')) return { url, consumed: [] };
  const consumed: string[] = [];
  const substituted = url.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => {
    const value = payload[key];
    if (value === undefined || value === null || value === '') return match;
    consumed.push(key);
    // Encoded: an identifier with a slash in it would otherwise silently change the path it addresses.
    return encodeURIComponent(String(value));
  });
  return { url: substituted, consumed };
}

/**
 * Dispatch to the institution that owns the entity in question.
 *
 * For `card_issuer`, `card_authorization`, `account_information`, `payment_initiation` and `aspsp`, the
 * provider is not a matter of preference: it is the bank that issued THIS card or holds THIS account. The
 * resolution is REQUIRED here rather than optional, because a capability bound to an entity cannot be
 * dispatched without saying which entity, and making it optional is precisely how all six call sites came to
 * omit it and route by strategy instead.
 *
 * It REFUSES rather than falling back. Falling back for one of these means operating a different
 * institution's account, which is worse than not operating at all.
 */
export async function dispatchToInstitution(
  db: Db,
  type: EntityBoundProviderType,
  triggeredBy: string,
  payload: Record<string, unknown>,
  resolution: ResolutionContext,
  businessContext?: BusinessContextRef,
): Promise<DispatchResult> {
  return dispatchProvider(db, type, triggeredBy, payload, businessContext, resolution);
}

/**
 * Dispatch to whichever active provider the routing strategy picks.
 *
 * For fraud scoring, sanctions screening, identity and business verification, currency and the credit bureau,
 * any active provider can answer and priority, weight or round-robin decides which. There is no entity to bind
 * to, so there is nothing to resolve.
 */
export async function dispatchByStrategy(
  db: Db,
  type: StrategyBoundProviderType,
  triggeredBy: string,
  payload: Record<string, unknown>,
  businessContext?: BusinessContextRef,
): Promise<DispatchResult> {
  return dispatchProvider(db, type, triggeredBy, payload, businessContext);
}

/**
 * The one dispatch pipeline, behind both doors above.
 *
 * Kept single deliberately. Capability-specific pipelines would fork the audit trail that carries the
 * compliance narrative, so what varies per capability is the RESOLVER in front of it and the contract of the
 * door, never the logging, the events or the field mapping behind it.
 */
export async function dispatchProvider(
  db: Db,
  type: IntegrationProviderType,
  triggeredBy: string,
  payload: Record<string, unknown>,
  businessContext?: BusinessContextRef,
  resolution?: ResolutionContext,
): Promise<DispatchResult> {
  // An entity-bound capability with nothing to resolve from is REFUSED, not routed by strategy.
  //
  // This is the failure the two doors above exist to prevent, caught here as well because the pipeline is
  // reachable directly and a compiler cannot see through an `as` or a dynamic capability. Falling through to
  // "any active provider" is what it used to do, and with several banks registered that means asking the wrong
  // institution about someone else's card, which it will correctly know nothing about.
  if (isEntityBound(type) && !resolution) {
    return {
      provider: 'internal',
      arrangementId: '',
      status: 'error',
      latencyMs: 0,
      error: `${type} is bound to an entity and was dispatched without one, so no institution could be chosen`,
    };
  }

  // ── P6.1: entity-bound capabilities resolve BY THE DATA, before any strategy is considered ──────
  //
  // The pipeline below is untouched on purpose. Five capability-specific dispatchers would fork the audit
  // trail that carries the compliance narrative, so the resolver is injected here and everything after it,
  // the logging, the events, the field mapping, stays single sourced.
  if (resolverKindFor(type) === 'entity_bound' && resolution) {
    const resolved = await resolveProvider(db, type, resolution);
    if (!resolved.ok) {
      // A REFUSAL, not a fallback (P6.4). For an entity-bound capability, falling back to another provider
      // means operating a different institution's account, which is worse than not operating at all.
      return {
        provider: 'internal',
        arrangementId: '',
        status: 'error',
        latencyMs: 0,
        error: `${type} could not be routed: ${resolved.reason}`,
      };
    }
    // Dispatched over the wire when there is something to call, which is a base URL or a path, not merely the
    // legacy single-endpoint field.
    //
    // That field used to be the only test, and it held a LOOPBACK path back into the PSP for the capabilities
    // the PSP served itself. Removing the loopback therefore made the bank unreachable through this pipeline:
    // the provider looked like it had no endpoint, so the dispatch fell through to the internal branch and
    // recorded a "sent" that went nowhere. An institution reached by declared per-event paths against its own
    // base URL has no use for the single field, and asking the wrong question here is silent.
    if (reachableOverTheWire(resolved.provider)) {
      return dispatchExternal(db, resolved.provider, triggeredBy, payload, businessContext);
    }
    return logAndReturn(db, resolved.provider, triggeredBy, payload, businessContext, {
      provider: 'internal',
      arrangementId: resolved.provider.externalProviderArrangementInstanceReference,
      status: 'sent',
      latencyMs: 0,
    });
  }

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
    const group = await db.collection<IntegrationRoutingGroup>(EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION)
      .findOne({ routingGroupInstanceReference: provider.routingGroupId });
    if (group) {
      const resolved = await resolveProviderFromGroup(db, group);
      if (resolved) {
        // ADR-025: endpoint-first. Reachable means a base url or a path, not the legacy field alone.
        if (reachableOverTheWire(resolved)) {
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

  // ADR-025: endpoint-first dispatch logic. An internal provider with a path still makes a real HTTP call,
  // which is how the surviving built-in engines are reached; an institution is reached by its base url.
  if (reachableOverTheWire(provider)) {
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

// v37 P6.2d: `oauth2_cc` had no branch here at all, so a Hub dispatch with client credentials carried NO
// token and the provider answered 401. Nothing used the scheme until the bank arrived, which is why it had
// never failed: the gap was invisible precisely because it was unreachable.
//
// Async because obtaining a token is a network call. The token is cached per provider and scope by the
// service below, so this is one exchange per lifetime rather than one per dispatch.
async function buildAuthHeaders(
  authConfig?: IntegrationAuthConfig,
  providerType?: IntegrationProviderType,
): Promise<Record<string, string>> {
  if (!authConfig) {
    return { 'X-Integration-Source': 'psp-demo' };
  }

  const { scheme, bearer, apiKey } = authConfig;

  if (scheme === 'oauth2_cc' && providerType) {
    const { accessToken, error } = await getProviderAccessToken(providerType);
    if (!accessToken) {
      // No header rather than a bogus one: the provider's 401 then says what actually happened, and the
      // dispatch log carries the reason instead of an unexplained rejection.
      return { 'X-Integration-Source': 'psp-demo', 'X-Integration-Auth-Error': String(error ?? 'no token') };
    }
    return { Authorization: `Bearer ${accessToken}`, 'X-Integration-Source': 'psp-demo' };
  }

  if (scheme === 'bearer' && bearer) {
    // API key is bcrypt-hashed: we can't recover the plaintext in a demo.
    // In production, the plaintext key would be in AWS Secrets Manager.
    const headerName = bearer.tokenHeaderName ?? 'Authorization';
    const prefix = bearer.tokenPrefix ?? 'Bearer';
    return {
      [headerName]: `${prefix} [demo-key-placeholder]`,
      'X-Integration-Source': 'psp-demo',
    };
  }

  if (scheme === 'api_key' && apiKey) {
    if (apiKey.keyLocation === 'header') {
      const headerName = apiKey.keyHeaderName ?? 'X-API-Key';
      const prefix = apiKey.keyPrefix ?? '';
      return {
        [headerName]: `${prefix}[demo-key-placeholder]`,
        'X-Integration-Source': 'psp-demo',
      };
    }
  }

  return { 'X-Integration-Source': 'psp-demo' };
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

  // §2.4: resolve the wire config for THIS event (url, method, mapping, auth, timeout), per-event when
  // configured, vendor-global as the migration fallback. `triggeredBy` is the bus event name.
  const wire = resolveEventOutbound(provider, triggeredBy);

  // Apply outbound field mapping before sending. The MAPPED payload goes to the connector (it may
  // rename CHD, e.g. cardNumber -> card_value, for a card issuer). PCI DSS: we log the
  // ORIGINAL (pre-mapping) payload, where CHD lives under known keys that sanitizeDeep strips: the
  // mapped body (with aliased CHD) is NEVER persisted, only transmitted.
  const mappedPayload = wire.mapping.length
    ? applyMappings(payload, wire.mapping)
    : payload;

  const fieldMappingApplied = mappedPayload !== payload;

  // Payload keys spent on headers, so they are not also sent in the body.
  const consumedByHeaders: string[] = [];

  // Declared outside try so the catch branch can include the request in its audit capture.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await buildAuthHeaders(wire.auth, provider.externalProviderArrangementType)),
  };

  // Declared headers, templated from the payload exactly as the url is. A placeholder with nothing to fill it
  // is DROPPED rather than sent literally: `Consent-ID: {consentId}` reaching a bank as that text would be
  // refused as an invalid consent, which reads as a consent problem instead of a configuration one.
  for (const [name, template] of Object.entries(wire.headers ?? {})) {
    const { url: value, consumed: used } = applyPathTemplate(template, mappedPayload);
    if (value.includes('{')) continue;
    headers[name] = value;
    consumedByHeaders.push(...used);
  }

  // v37 P6.2d: a REST RESOURCE api addresses things in the PATH, so a configured url may be a template
  // (`/v1/accounts/{accountId}/balances`). Substituting from the payload is what lets a standard bank API be
  // dispatched through the same pipeline as a single-endpoint connector, instead of needing its own client.
  const { url: templatedUrl, consumed } = applyPathTemplate(wire.url ?? '', mappedPayload);

  // A host-less path resolves against the provider's own base URL when it has one (a real ASPSP), and
  // against the PSP's otherwise (the built-in loopback engines). Absolute URLs pass through unchanged.
  const targetUrl = resolveServiceUrl(templatedUrl, provider.externalProviderBaseUrl);

  // A GET or DELETE with a JSON body is not a request most servers will read, and some reject it outright.
  // The fields that went INTO the path are dropped from the body either way: sending them twice invites a
  // mismatch between the two, which is the kind of bug that only shows up on the one that is ignored.
  const method = (wire.httpMethod ?? 'POST').toUpperCase();
  const sendsBody = method !== 'GET' && method !== 'DELETE';
  // Keys spent on the path OR on a header are not repeated in the body.
  const spent = [...consumed, ...consumedByHeaders];
  const bodyPayload = spent.length
    ? Object.fromEntries(Object.entries(mappedPayload).filter(([key]) => !spent.includes(key)))
    : mappedPayload;

  try {

    const controller = new AbortController();
    // Internal providers dispatch via an HTTP loopback to our own API (ADR-025 endpoint-first). That
    // round-trip is more than a local function call, so enforce a sane minimum timeout to avoid
    // spurious AbortError timeouts on a busy event loop; external providers keep their configured value.
    const configuredTimeout = wire.timeoutMs;
    const effectiveTimeout = provider.externalProviderIsInternal ? Math.max(configuredTimeout, 1500) : configuredTimeout;
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

    const res = await fetch(targetUrl, {
      method: wire.httpMethod,
      headers,
      ...(sendsBody ? { body: JSON.stringify(bodyPayload) } : {}),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    const status = res.ok ? 'received' : 'error';

    // Capture the response body + headers (best-effort) so the audit can show exactly what came back.
    let responseBody: unknown;
    try { const text = await res.text(); try { responseBody = JSON.parse(text); } catch { responseBody = text; } } catch { /* no body */ }
    const responseHeaders = Object.fromEntries(res.headers.entries());

    await logEvent(db, {
      arrangementId,
      type: 'dispatch',
      status,
      triggeredBy,
      payload,
      responseCode: res.status,
      latencyMs,
      meta: { fieldMappingApplied },
      businessContext,
      request: { method: wire.httpMethod, url: targetUrl, headers, body: payload },
      response: { status: res.status, headers: responseHeaders, body: responseBody },
    });

    await updateHealthStatus(db, arrangementId, res.ok ? 'ok' : 'degraded');

    // The response is translated through the provider's INBOUND mapping before it leaves here.
    //
    // Without this the caller had to speak each provider's own vocabulary, and the separation of the bank made
    // that immediately dangerous: the bank answers a card validation with `valid`, the payment flow reads
    // `actionConfirmed`, and `undefined !== false` is TRUE, so a card the issuer REJECTED was approved. The
    // mapping is what the arrangement is for, and applying it on the synchronous path is what makes a declared
    // translation actually take effect.
    const mapped = mapInbound(provider, triggeredBy, responseBody);
    return { provider: 'external', arrangementId, status, latencyMs, responseCode: res.status, responseBody: mapped };
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
      meta: { fieldMappingApplied },
      businessContext,
      request: { method: wire.httpMethod, url: targetUrl, headers, body: payload },
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
    request?: { method: string; url?: string; headers?: Record<string, string>; body?: unknown };
    response?: { status?: number; headers?: Record<string, string>; body?: unknown };
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
    // Sanitized request/response capture (auth/CHD redacted): PCI DSS.
    ...(opts.request ? { integrationEventRequest: sanitizeDeep(opts.request) as IntegrationEvent['integrationEventRequest'] } : {}),
    ...(opts.response ? { integrationEventResponse: sanitizeDeep(opts.response) as IntegrationEvent['integrationEventResponse'] } : {}),
    businessContext: opts.businessContext,
    bianServiceDomain: 'External Provider Arrangements',
    bianControlRecordType: 'ExternalProviderArrangementActionLog',
    recordCreatedDateTime: new Date(),
  };

  void db.collection<IntegrationEvent>(EXTERNAL_PROVIDER_ARRANGEMENT_ACTION_LOG_COLLECTION).insertOne(event).catch(() => {});

  // §5.0: the action log is the HTTP wire I/O record only, it NEVER originates or relays domain
  // events. (Removed the legacy mirror-to-bus: per-gate *.requested/*.completed are published by the
  // provider groups directly, §9.2/P5, so the journey trail is fed from the bus, not from this log.)
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
      body: JSON.stringify({ test: true, source: 'psp-demo' }),
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

// Resolve an internal PSP path (e.g. /api/v1/modules/fds/score) to an absolute URL using PSP_BASE_URL
// (default http://127.0.0.1:8081). Seeded configs MUST be host-less paths so they work unchanged across
// environments/deployments; only this resolver knows the runtime host. Absolute URLs (real external
// providers) are returned untouched.
/**
 * Translates a provider's response into the vocabulary the caller uses, per the arrangement's inbound mapping.
 *
 * A non-object body is returned untouched: a mapping describes fields, and there are none to move in a string
 * or an array. A mapping that throws is also returned untouched rather than swallowed into an empty object,
 * because losing the response entirely is worse than returning it unmapped.
 */
/**
 * Whether this provider is reachable over the wire.
 *
 * A single predicate on purpose. The choice between an HTTP dispatch and an in-process stub was made in THREE
 * places, each testing `externalProviderApiEndpoint` alone, and that field held a LOOPBACK path for the
 * capabilities the provider used to serve itself. Removing the loopback in v37 P12 was correct and it silently
 * turned all three into the stub branch: the dispatch reported `sent`, nothing was called, and the card
 * validation never reached the bank. It failed closed rather than dangerously, but it failed.
 *
 * An institution reached by declared per-event paths against its own base url has no use for the single legacy
 * field, so the question is whether there is ANYTHING to call.
 */
function reachableOverTheWire(provider: ExternalProviderArrangement): boolean {
  return Boolean(provider.externalProviderBaseUrl || provider.externalProviderApiEndpoint);
}

function mapInbound(
  provider: ExternalProviderArrangement,
  event: string,
  body: unknown,
): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const rules = resolveEventInbound(provider, event).mapping;
  if (!rules.length) return body;
  try {
    return applyMappings(body as Record<string, unknown>, rules);
  } catch {
    return body;
  }
}

export function resolveServiceUrl(url: string, providerBaseUrl?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  // v37 P6.2d: the PROVIDER's own base URL wins for a host-less path, and only then the PSP's own.
  //
  // Without this a configured standard path (`/v1/accounts/{accountId}/balances`) resolved against
  // PSP_BASE_URL and was sent to the PSP itself, so a real ASPSP could not be reached through this pipeline
  // at all and needed a bespoke client instead. The bank's base URL lives on the same record as its
  // credential precisely so the two cannot be picked from different records.
  const raw = providerBaseUrl?.trim() || process.env.PSP_BASE_URL || '127.0.0.1:8081';
  const base = (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/$/, '');
  return base + (url.startsWith('/') ? url : `/${url}`);
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

// "Run Test": a REAL execution (distinct from test-mapping/Validate Params which only
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

  // outbound: real HTTP dispatch to the override URL or the configured endpoint
  const rawTarget = overrideUrl?.trim() || provider.externalProviderApiEndpoint;
  if (!rawTarget) {
    return { direction, executed: false, status: 'error', latencyMs: 0, transformed, appliedRules: rules.length, error: 'No endpoint configured and no override URL provided.' };
  }
  const targetUrl = resolveServiceUrl(rawTarget);

  // The credential is obtained BEFORE the clock starts, as it is on the live path above.
  //
  // This timeout is meant to bound the call to the PROVIDER. Arming it first also charged it for
  // acquiring the token to make that call, which is a request to the authority and not to the
  // provider at all: on a cold token cache the two together exceeded the budget, and the provider was
  // marked degraded for a delay that was never its own.
  const authHeaders = await buildAuthHeaders(provider.authConfig, provider.externalProviderArrangementType);

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), provider.externalProviderTimeoutMs ?? 5000);
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Integration-Test': 'true',
        ...authHeaders,
      },
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
  const col = db.collection<IntegrationEvent>(EXTERNAL_PROVIDER_ARRANGEMENT_ACTION_LOG_COLLECTION);
  const query = { externalProviderArrangementInstanceReference: arrangementId };
  const [events, total] = await Promise.all([
    col.find(query).sort({ recordCreatedDateTime: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(query),
  ]);
  return { events, total };
}

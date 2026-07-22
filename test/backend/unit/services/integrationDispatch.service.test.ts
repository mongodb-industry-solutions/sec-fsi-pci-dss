/**
 * Unit tests: integrationDispatch.service — ADR-025 endpoint-first logic (F7.2)
 * Covers: provider with endpoint → fetch called; no endpoint + internal → logAndReturn;
 *         businessContext propagated to integrationEvents document.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const insertOne = vi.fn().mockResolvedValue({ insertedId: 'mock-id' });
  const findOne    = vi.fn();
  const updateOne  = vi.fn().mockResolvedValue({});
  const collection = vi.fn(() => ({ insertOne, findOne, updateOne }));

  // fetch mock — returns a successful 200 response by default
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ status: 'ok' }),
    // dispatchExternal reads the body via res.text() then JSON.parse, and captures res.headers.entries().
    text: vi.fn().mockResolvedValue('{"status":"ok"}'),
    headers: { entries: () => [] as [string, string][] },
  });

  return { insertOne, findOne, updateOne, collection, fetchMock };
});

vi.mock('../../../../backend/src/modules/provider/services/integrationRegistry.service', () => ({
  getActiveProviderForType: h.findOne,
  updateHealthStatus: vi.fn().mockResolvedValue(undefined),
  hashPayload: vi.fn().mockReturnValue('hash-abc'),
}));

vi.mock('../../../../backend/src/modules/provider/services/fieldMapping.service', () => ({
  applyMappings: vi.fn((p: unknown) => p),
}));

vi.mock('../../../../backend/src/modules/provider/services/integrationRoutingGroup.service', () => ({
  resolveProviderFromGroup: vi.fn().mockResolvedValue(null),
}));

// Stub the global fetch
vi.stubGlobal('fetch', h.fetchMock);

import { dispatchProvider } from '../../../../backend/src/modules/provider/services/integrationDispatch.service';
import { resolveProviderFromGroup } from '../../../../backend/src/modules/provider/services/integrationRoutingGroup.service';

function makeDb() {
  return { collection: h.collection } as unknown as Parameters<typeof dispatchProvider>[0];
}

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    externalProviderArrangementInstanceReference: 'prov-001',
    externalProviderArrangementType: 'fraud_detection',
    externalProviderArrangementStatus: 'active',
    externalProviderIsInternal: true,
    externalProviderMode: 'sync',
    externalProviderTimeoutMs: 500,
    externalProviderRetryPolicy: { maxAttempts: 1, backoffMs: 0 },
    fieldMappingConfig: { outbound: [], inbound: [], schemaVersion: 1 },
    ...overrides,
  };
}

beforeEach(() => {
  h.insertOne.mockClear();
  h.findOne.mockClear();
  h.fetchMock.mockClear();
  h.collection.mockClear();
  h.fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ status: 'ok' }),
    text: vi.fn().mockResolvedValue('{"status":"ok"}'),
    headers: { entries: () => [] as [string, string][] },
  });
});

// ── endpoint-first dispatch ───────────────────────────────────────────────────

describe('endpoint-first dispatch logic (ADR-025 D3)', () => {
  it('calls fetch when provider has externalProviderApiEndpoint (even if internal)', async () => {
    h.findOne.mockResolvedValueOnce(
      makeProvider({ externalProviderApiEndpoint: 'http://localhost:8081/api/v1/modules/fds/score' })
    );
    const result = await dispatchProvider(makeDb(), 'fraud_detection', 'test', { amount: 100 });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.fetchMock).toHaveBeenCalledWith(
      'http://localhost:8081/api/v1/modules/fds/score',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.provider).toBe('external');
    expect(result.status).toBe('received');
  });

  it('does NOT call fetch when internal provider has no endpoint (logAndReturn)', async () => {
    h.findOne.mockResolvedValueOnce(
      makeProvider({ externalProviderIsInternal: true }) // no externalProviderApiEndpoint
    );
    const result = await dispatchProvider(makeDb(), 'fraud_detection', 'test', { amount: 100 });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(result.provider).toBe('internal');
    expect(result.status).toBe('sent');
  });

  it('calls fetch for external provider with endpoint', async () => {
    h.findOne.mockResolvedValueOnce(
      makeProvider({
        externalProviderIsInternal: false,
        externalProviderApiEndpoint: 'https://api.refinitiv.com/fds/score',
      })
    );
    await dispatchProvider(makeDb(), 'fraud_detection', 'test', { amount: 500 });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns error status when no active provider found', async () => {
    h.findOne.mockResolvedValueOnce(null);
    const result = await dispatchProvider(makeDb(), 'fraud_detection', 'test', {});
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/no active provider/i);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

// ── businessContext propagated ────────────────────────────────────────────────

describe('businessContext persisted in integrationEvents', () => {
  it('includes businessContext in the logged IntegrationEvent when provided', async () => {
    h.findOne.mockResolvedValueOnce(
      makeProvider({ externalProviderIsInternal: true }) // no endpoint → logAndReturn
    );
    const ctx = { entityType: 'transaction' as const, entityId: 'txn-abc', processType: 'payment_processing' as const };
    await dispatchProvider(makeDb(), 'fraud_detection', 'test', { amount: 50 }, ctx);

    // insertOne is called to log the integrationEvent
    expect(h.insertOne).toHaveBeenCalled();
    const doc = h.insertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(doc.businessContext).toEqual(ctx);
  });

  it('logs integrationEvent without businessContext when not passed', async () => {
    h.findOne.mockResolvedValueOnce(makeProvider({ externalProviderIsInternal: true }));
    await dispatchProvider(makeDb(), 'fraud_detection', 'test', { amount: 50 });
    const doc = h.insertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(doc.businessContext).toBeUndefined();
  });
});

// ── category routing (no hardcoded provider in domain) — dev.v30 FR-30.9 ──────

describe('category routing (dev.v30 FR-30.9 / R9)', () => {
  it('resolves the active provider for the exact category passed by the caller', async () => {
    h.findOne.mockResolvedValueOnce(makeProvider({ externalProviderArrangementType: 'card_issuer' }));
    await dispatchProvider(makeDb(), 'card_issuer', 'card.issuer.validation.requested', {});
    // getActiveProviderForType (mocked as h.findOne) must be called with the caller's category,
    // proving the type is data-driven and not hardcoded in the dispatch path.
    expect(h.findOne).toHaveBeenCalledWith(expect.anything(), 'card_issuer');
  });

  it('routes each category independently (card_issuer, fraud_detection, hrp_sanctions, account_information)', async () => {
    for (const category of ['card_issuer', 'fraud_detection', 'hrp_sanctions', 'account_information'] as const) {
      h.findOne.mockResolvedValueOnce(makeProvider({ externalProviderArrangementType: category }));
      await dispatchProvider(makeDb(), category, `${category}.test`, {});
      expect(h.findOne).toHaveBeenLastCalledWith(expect.anything(), category);
    }
  });
});

// ── routing-group resolution — endpoint-first on the resolved member ──────────

describe('routing group resolution (ADR-025)', () => {
  it('dispatches to the group-resolved external member when it has an endpoint', async () => {
    h.findOne.mockResolvedValueOnce(
      makeProvider({ externalProviderIsInternal: false, routingGroupId: 'grp-1' })
    );
    // The group lookup uses db.collection(...).findOne — reuse the same mock; return a group doc.
    h.findOne.mockResolvedValueOnce({ routingGroupInstanceReference: 'grp-1' });
    vi.mocked(resolveProviderFromGroup).mockResolvedValueOnce(
      makeProvider({
        externalProviderIsInternal: false,
        externalProviderApiEndpoint: 'https://api.vendor.com/score',
      }) as never
    );
    const result = await dispatchProvider(makeDb(), 'fraud_detection', 'test', {});
    expect(h.fetchMock).toHaveBeenCalledWith('https://api.vendor.com/score', expect.objectContaining({ method: 'POST' }));
    expect(result.provider).toBe('external');
  });
});

// ── timeout handling ──────────────────────────────────────────────────────────

describe('timeout handling', () => {
  it('returns timeout status when fetch throws AbortError', async () => {
    h.findOne.mockResolvedValueOnce(
      makeProvider({ externalProviderApiEndpoint: 'http://localhost:8081/api/v1/modules/fds/score' })
    );
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    h.fetchMock.mockRejectedValueOnce(abortErr);

    const result = await dispatchProvider(makeDb(), 'fraud_detection', 'test', {});
    expect(result.status).toBe('timeout');
  });
});

/**
 * Unit tests: integrationRegistry.service (FR-v6-03, FR-v6-05, FR-v6-07)
 * Source: backend/src/modules/integrations/services/integrationRegistry.service.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createIntegration,
  rotateKey,
  suspendIntegration,
  verifyApiKey,
  stripSecrets,
} from '../../../../backend/src/modules/integrations/services/integrationRegistry.service';
import type { ExternalProviderArrangement } from '../../../../backend/src/modules/integrations/models/externalProviderArrangement.model';

// ── Minimal DB mock ──────────────────────────────────────────────────────────

function makeDb(opts?: {
  findOneResult?: Partial<ExternalProviderArrangement> | null;
  insertError?: Error;
}) {
  const insertOne       = vi.fn().mockResolvedValue({ insertedId: 'mock' });
  const findOne         = vi.fn().mockResolvedValue(opts?.findOneResult ?? null);
  const updateOne       = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const findOneAndUpdate = vi.fn().mockImplementation((_query: unknown, update: { $set?: Record<string, unknown> }) => {
    // Return the findOneResult merged with the $set fields so callers see the updated doc
    const base = opts?.findOneResult ?? {};
    return Promise.resolve({ ...base, ...(update.$set ?? {}) });
  });

  if (opts?.insertError) {
    insertOne.mockRejectedValue(opts.insertError);
  }

  return {
    collection: vi.fn().mockReturnValue({ insertOne, findOne, updateOne, findOneAndUpdate }),
    _insertOne:        insertOne,
    _findOne:          findOne,
    _updateOne:        updateOne,
    _findOneAndUpdate: findOneAndUpdate,
  } as unknown as ReturnType<typeof makeDb>;
}

// ── createIntegration ────────────────────────────────────────────────────────

describe('createIntegration', () => {
  it('returns a plaintext apiKey in the response', async () => {
    const db = makeDb();
    const result = await createIntegration(db as never, {
      name: 'Test FDS',
      type: 'fraud_detection',
      mode: 'sync',
      endpoint: 'https://api.test.com/v1/score',
      triggerEvents: [],
    });
    expect(result.apiKey).toBeTruthy();
    expect(typeof result.apiKey).toBe('string');
    expect(result.apiKey!.length).toBeGreaterThan(20);
  });

  it('does NOT expose the apiKey hash in the integration document', async () => {
    const db = makeDb();
    const result = await createIntegration(db as never, {
      name: 'Test FDS', type: 'fraud_detection', mode: 'sync', triggerEvents: [],
    });
    expect((result.integration as Record<string, unknown>).externalProviderApiKeyHash).toBeUndefined();
    expect((result.integration as Record<string, unknown>).externalProviderCallbackSecretHash).toBeUndefined();
  });

  it('stores the bcrypt hash in the DB (not the plaintext key)', async () => {
    const db = makeDb();
    const result = await createIntegration(db as never, {
      name: 'Test FDS', type: 'fraud_detection', mode: 'sync', triggerEvents: [],
    });
    const storedDoc = db._insertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(storedDoc.externalProviderApiKeyHash).toBeTruthy();
    expect(storedDoc.externalProviderApiKeyHash).not.toBe(result.apiKey);
    expect(String(storedDoc.externalProviderApiKeyHash).startsWith('$2')).toBe(true);
  });

  it('sets externalProviderIsInternal to false for external providers', async () => {
    const db = makeDb();
    await createIntegration(db as never, {
      name: 'Test FDS', type: 'fraud_detection', mode: 'sync', triggerEvents: [],
    });
    const storedDoc = db._insertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(storedDoc.externalProviderIsInternal).toBe(false);
  });

  it('returns an externalProviderArrangementInstanceReference UUID', async () => {
    const db = makeDb();
    const { integration } = await createIntegration(db as never, {
      name: 'Test FDS', type: 'fraud_detection', mode: 'sync', triggerEvents: [],
    });
    expect((integration as Record<string, unknown>).externalProviderArrangementInstanceReference).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('stores the apiKeyPrefix (first 8 chars) for display', async () => {
    const db = makeDb();
    const { apiKey } = await createIntegration(db as never, {
      name: 'Test FDS', type: 'fraud_detection', mode: 'sync', triggerEvents: [],
    });
    const storedDoc = db._insertOne.mock.calls[0][0] as Record<string, unknown>;
    expect(storedDoc.externalProviderApiKeyPrefix).toBe(apiKey!.substring(0, 12) + '...');
  });
});

// ── verifyApiKey ─────────────────────────────────────────────────────────────

describe('verifyApiKey', () => {
  it('returns true for the correct plaintext key', async () => {
    // Create first so we get the hash
    const db = makeDb();
    const { apiKey, integration } = await createIntegration(db as never, {
      name: 'Verify Test', type: 'fraud_detection', mode: 'sync', triggerEvents: [],
    });
    const storedDoc = db._insertOne.mock.calls[0][0] as Partial<ExternalProviderArrangement>;

    // Mock findOne to return the doc with hash
    const db2 = makeDb({ findOneResult: storedDoc });
    const id = (integration as Record<string, unknown>).externalProviderArrangementInstanceReference as string;
    const result = await verifyApiKey(db2 as never, id, apiKey!);
    expect(result).toBe(true);
  });

  it('returns false for a wrong plaintext key', async () => {
    const db = makeDb();
    await createIntegration(db as never, {
      name: 'Verify Test', type: 'fraud_detection', mode: 'sync', triggerEvents: [],
    });
    const storedDoc = db._insertOne.mock.calls[0][0] as Partial<ExternalProviderArrangement>;

    const db2 = makeDb({ findOneResult: storedDoc });
    const result = await verifyApiKey(db2 as never, 'any-id', 'wrong-key');
    expect(result).toBe(false);
  });
});

// ── rotateKey ────────────────────────────────────────────────────────────────

describe('rotateKey', () => {
  it('rejects rotation of internal providers with code 400', async () => {
    const internalProvider: Partial<ExternalProviderArrangement> = {
      externalProviderArrangementInstanceReference: 'int-internal-fds-001',
      externalProviderIsInternal: true,
      externalProviderArrangementName: 'Internal FDS',
    };
    const db = makeDb({ findOneResult: internalProvider });

    await expect(rotateKey(db as never, 'int-internal-fds-001'))
      .rejects.toMatchObject({ code: 400 });
  });

  it('returns a new plaintext key for external providers', async () => {
    const externalProvider: Partial<ExternalProviderArrangement> = {
      externalProviderArrangementInstanceReference: 'ext-001',
      externalProviderIsInternal: false,
      externalProviderArrangementName: 'External FDS',
      externalProviderArrangementType: 'fraud_detection',
    };
    const db = makeDb({ findOneResult: externalProvider });
    const result = await rotateKey(db as never, 'ext-001');
    expect(result).not.toBeNull();
    expect(result!.apiKey).toBeTruthy();
    expect(result!.apiKey.length).toBeGreaterThan(20);
  });

  it('stores an updated bcrypt hash after rotation', async () => {
    const externalProvider: Partial<ExternalProviderArrangement> = {
      externalProviderArrangementInstanceReference: 'ext-002',
      externalProviderIsInternal: false,
      externalProviderArrangementName: 'External AML',
      externalProviderArrangementType: 'aml_monitoring',
    };
    const db = makeDb({ findOneResult: externalProvider });
    await rotateKey(db as never, 'ext-002');
    const updateCall = db._findOneAndUpdate.mock.calls[0];
    const setPayload = updateCall[1].$set as Record<string, unknown>;
    expect(String(setPayload.externalProviderApiKeyHash).startsWith('$2')).toBe(true);
  });
});

// ── suspendIntegration ────────────────────────────────────────────────────────

describe('suspendIntegration', () => {
  it('rejects suspension of internal providers with code 400', async () => {
    const internalProvider: Partial<ExternalProviderArrangement> = {
      externalProviderArrangementInstanceReference: 'int-internal-hrp-001',
      externalProviderIsInternal: true,
      externalProviderArrangementName: 'Internal HRPC',
    };
    const db = makeDb({ findOneResult: internalProvider });

    await expect(suspendIntegration(db as never, 'int-internal-hrp-001'))
      .rejects.toMatchObject({ code: 400 });
  });

  it('sets status to suspended for external providers', async () => {
    const externalProvider: Partial<ExternalProviderArrangement> = {
      externalProviderArrangementInstanceReference: 'ext-003',
      externalProviderIsInternal: false,
      externalProviderArrangementName: 'External KYC',
      externalProviderArrangementType: 'kyc_identity',
      externalProviderArrangementStatus: 'active',
    };
    const db = makeDb({ findOneResult: externalProvider });
    await suspendIntegration(db as never, 'ext-003');
    const updateCall = db._findOneAndUpdate.mock.calls[0];
    const setPayload = updateCall[1].$set as Record<string, unknown>;
    expect(setPayload.externalProviderArrangementStatus).toBe('suspended');
  });
});

// ── stripSecrets ─────────────────────────────────────────────────────────────

describe('stripSecrets', () => {
  it('removes externalProviderApiKeyHash and externalProviderCallbackSecretHash', () => {
    const doc: Partial<ExternalProviderArrangement> = {
      externalProviderArrangementName: 'Test',
      externalProviderApiKeyHash: 'some-bcrypt-hash',
      externalProviderCallbackSecretHash: 'some-callback-hash',
    };
    const stripped = stripSecrets(doc as ExternalProviderArrangement);
    expect((stripped as Record<string, unknown>).externalProviderApiKeyHash).toBeUndefined();
    expect((stripped as Record<string, unknown>).externalProviderCallbackSecretHash).toBeUndefined();
    expect(stripped.externalProviderArrangementName).toBe('Test');
  });
});

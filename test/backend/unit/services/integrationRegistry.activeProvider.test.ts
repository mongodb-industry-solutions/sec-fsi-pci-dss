/**
 * Unit tests (dev.v30 FT / FR-30.9, FR-30.11): getActiveProviderForType / getActiveProvidersForType.
 * Pins the internal-first, then routingPriority-ASC selection contract (R9). No DB: the provider
 * collection find().toArray() is mocked.
 *
 * Source: backend/src/modules/provider/services/integrationRegistry.service.ts
 */
import { describe, it, expect, vi } from 'vitest';
import {
  getActiveProviderForType,
  getActiveProvidersForType,
} from '../../../../backend/src/modules/provider/services/integrationRegistry.service';
import type { ExternalProviderArrangement } from '../../../../backend/src/modules/provider/models/externalProviderArrangement.model';

type ProviderStub = Partial<ExternalProviderArrangement>;

// Db mock: the provider collection's find() returns a cursor whose toArray() yields `docs`.
// getActive*ForType does the ordering in memory, so the mock returns them unsorted.
function makeDb(docs: ProviderStub[]) {
  const toArray = vi.fn(async () => docs);
  const find = vi.fn(() => ({ toArray }));
  return {
    collection: vi.fn(() => ({ find })),
    _find: find,
  } as unknown as ReturnType<typeof makeDb> & { _find: typeof find };
}

describe('getActiveProvidersForType', () => {
  it('sorts internal providers before external ones', async () => {
    const db = makeDb([
      { externalProviderArrangementInstanceReference: 'ext-1', externalProviderIsInternal: false, routingPriority: 10 },
      { externalProviderArrangementInstanceReference: 'int-1', externalProviderIsInternal: true, routingPriority: 999 },
    ]);
    const result = await getActiveProvidersForType(db, 'fraud_detection');
    expect(result.map(p => p.externalProviderArrangementInstanceReference)).toEqual(['int-1', 'ext-1']);
  });

  it('orders external providers by routingPriority ASC', async () => {
    const db = makeDb([
      { externalProviderArrangementInstanceReference: 'ext-b', externalProviderIsInternal: false, routingPriority: 50 },
      { externalProviderArrangementInstanceReference: 'ext-a', externalProviderIsInternal: false, routingPriority: 20 },
      { externalProviderArrangementInstanceReference: 'ext-c', externalProviderIsInternal: false, routingPriority: 100 },
    ]);
    const result = await getActiveProvidersForType(db, 'fraud_detection');
    expect(result.map(p => p.externalProviderArrangementInstanceReference)).toEqual(['ext-a', 'ext-b', 'ext-c']);
  });

  it('queries only active providers of the requested type', async () => {
    const db = makeDb([]);
    await getActiveProvidersForType(db, 'card_issuer');
    expect(db._find).toHaveBeenCalledWith({
      externalProviderArrangementType: 'card_issuer',
      externalProviderArrangementStatus: 'active',
    });
  });
});

describe('getActiveProviderForType', () => {
  it('returns the internal provider first even when an external one exists', async () => {
    const db = makeDb([
      { externalProviderArrangementInstanceReference: 'ext-1', externalProviderIsInternal: false, routingPriority: 5 },
      { externalProviderArrangementInstanceReference: 'int-1', externalProviderIsInternal: true, routingPriority: 999 },
    ]);
    const result = await getActiveProviderForType(db, 'card_issuer');
    expect(result?.externalProviderArrangementInstanceReference).toBe('int-1');
  });

  it('returns null when no active provider exists', async () => {
    const db = makeDb([]);
    expect(await getActiveProviderForType(db, 'card_issuer')).toBeNull();
  });
});

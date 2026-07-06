/**
 * Unit test (dev.v8 P11c, §2.4/§7.7): the inbound callback applies PER-EVENT inbound mapping when the
 * event is supplied (the per-event callback route passes it); it falls back to vendor-global mapping
 * when no event/per-event config is present. Verified through processGenericCallback's logged snapshot.
 */
import { describe, it, expect, vi } from 'vitest';
import { processGenericCallback } from '../../../../backend/src/modules/provider/services/integrationCallback.service';
import type { ExternalProviderArrangement } from '../../../../backend/src/modules/provider/models/externalProviderArrangement.model';

function mockDb() {
  const insertOne = vi.fn().mockResolvedValue({ insertedId: 'x' });
  const db = { collection: vi.fn(() => ({ insertOne })) } as never;
  return { db, insertOne };
}

const vendor = {
  externalProviderArrangementInstanceReference: 'v1',
  externalProviderArrangementName: 'Vendor',
  externalProviderArrangementType: 'generic',
  externalProviderArrangementStatus: 'active',
  externalProviderIsInternal: false,
  externalProviderCallbackEnabled: true,
  externalProviderTriggerEvents: ['generic.notify'],
  externalProviderMode: 'async',
  // per-event inbound mapping renames `vendorStatus` -> `status`
  externalProviderEvents: [{
    event: 'generic.notify',
    outbound: {},
    inbound: { mapping: [{ sourcePath: 'vendorStatus', targetPath: 'status' }] },
  }],
  // vendor-global inbound mapping renames `legacyStatus` -> `status` (the fallback path)
  fieldMappingConfig: { outbound: [], inbound: [{ sourcePath: 'legacyStatus', targetPath: 'status' }], schemaVersion: 1 },
  bianServiceDomain: '', bianControlRecordType: '', pciDssRequirements: [],
  recordCreatedDateTime: new Date(), recordUpdatedDateTime: new Date(), schemaVersion: 3,
} as unknown as ExternalProviderArrangement;

const snapshotOf = (insertOne: ReturnType<typeof vi.fn>) =>
  (insertOne.mock.calls[0][0] as { integrationEventPayloadSnapshot?: Record<string, unknown> }).integrationEventPayloadSnapshot ?? {};

describe('per-event inbound mapping (§7.7)', () => {
  it('applies the per-event inbound mapping when the event is given', async () => {
    const { db, insertOne } = mockDb();
    await processGenericCallback(db, vendor, { vendorStatus: 'ok' } as never, 'generic.notify');
    expect(snapshotOf(insertOne).status).toBe('ok'); // vendorStatus -> status via per-event mapping
  });

  it('falls back to vendor-global inbound mapping when no event is given', async () => {
    const { db, insertOne } = mockDb();
    await processGenericCallback(db, vendor, { legacyStatus: 'done' } as never);
    expect(snapshotOf(insertOne).status).toBe('done'); // legacyStatus -> status via vendor-global mapping
  });
});

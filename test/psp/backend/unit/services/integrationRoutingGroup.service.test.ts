/**
 * Unit tests (dev.v30 FT / FR-30.9, FR-30.11): resolveProviderFromGroup routing strategies.
 * These pin the EDA + Hexagonal routing contract (R9): provider groups route providers by
 * category. No DB: a minimal in-memory collection mock drives findOne.
 *
 * Source: backend/src/modules/provider/services/integrationRoutingGroup.service.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveProviderFromGroup } from '../../../../../psp/backend/src/modules/provider/services/integrationRoutingGroup.service';
import type {
  IntegrationRoutingGroup,
  RoutingStrategy,
  ExternalProviderArrangement,
  RoutingGroupMember,
} from '../../../../../psp/backend/src/modules/provider/models/externalProviderArrangement.model';

type ProviderStub = Partial<ExternalProviderArrangement> & {
  externalProviderArrangementInstanceReference: string;
};

// Minimal Db whose provider collection findOne honours both the id match and the optional
// externalProviderArrangementStatus filter used by resolveProviderFromGroup.
function makeDb(providers: ProviderStub[]) {
  const byId = new Map(providers.map(p => [p.externalProviderArrangementInstanceReference, p]));
  const findOne = vi.fn(async (query: Record<string, unknown>) => {
    const id = query.externalProviderArrangementInstanceReference as string;
    const doc = byId.get(id);
    if (!doc) return null;
    if (query.externalProviderArrangementStatus &&
        doc.externalProviderArrangementStatus !== query.externalProviderArrangementStatus) {
      return null;
    }
    return doc;
  });
  return {
    collection: vi.fn(() => ({ findOne })),
    _findOne: findOne,
  } as unknown as ReturnType<typeof makeDb> & { _findOne: typeof findOne };
}

function member(id: string, priority: number): RoutingGroupMember {
  return { externalProviderArrangementInstanceReference: id, memberPriority: priority, memberRole: 'peer' };
}

// Deterministic sequential default ref (reproducible failures); tests needing a specific ref pass it.
let _grpSeq = 0;
function makeGroup(strategy: RoutingStrategy, members: RoutingGroupMember[], ref = `grp-${++_grpSeq}`): IntegrationRoutingGroup {
  return {
    routingGroupInstanceReference: ref,
    routingGroupName: 'test-group',
    routingGroupProviderType: 'fraud_detection',
    routingGroupStrategy: strategy,
    routingGroupStatus: 'active',
    routingGroupMembers: members,
    isDefaultGroup: false,
    bianServiceDomain: 'Fraud Evaluation',
    bianControlRecordType: 'ExternalProviderArrangementPortfolio',
    pciDssRequirements: [],
    recordCreatedDateTime: new Date(),
    recordUpdatedDateTime: new Date(),
  } as IntegrationRoutingGroup;
}

describe('resolveProviderFromGroup', () => {
  it('returns null for an empty group', async () => {
    const db = makeDb([]);
    const group = makeGroup('primary_fallback', []);
    expect(await resolveProviderFromGroup(db, group)).toBeNull();
  });

  describe('primary_fallback', () => {
    it('orders by memberPriority ASC and returns the lowest-priority reachable active member', async () => {
      const db = makeDb([
        { externalProviderArrangementInstanceReference: 'A', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'ok' },
        { externalProviderArrangementInstanceReference: 'B', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'ok' },
        { externalProviderArrangementInstanceReference: 'C', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'ok' },
      ]);
      // Members declared out of order: C is the highest priority (5).
      const group = makeGroup('primary_fallback', [member('A', 10), member('B', 20), member('C', 5)]);
      const result = await resolveProviderFromGroup(db, group);
      expect(result?.externalProviderArrangementInstanceReference).toBe('C');
    });

    it('skips an unreachable member and falls back to the next by priority', async () => {
      const db = makeDb([
        { externalProviderArrangementInstanceReference: 'C', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'unreachable' },
        { externalProviderArrangementInstanceReference: 'A', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'ok' },
        { externalProviderArrangementInstanceReference: 'B', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'ok' },
      ]);
      const group = makeGroup('primary_fallback', [member('A', 10), member('B', 20), member('C', 5)]);
      const result = await resolveProviderFromGroup(db, group);
      expect(result?.externalProviderArrangementInstanceReference).toBe('A');
    });

    it('skips an inactive (non-active status) member', async () => {
      const db = makeDb([
        { externalProviderArrangementInstanceReference: 'C', externalProviderArrangementStatus: 'suspended', externalProviderHealthStatus: 'ok' },
        { externalProviderArrangementInstanceReference: 'A', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'ok' },
      ]);
      const group = makeGroup('primary_fallback', [member('A', 10), member('C', 5)]);
      const result = await resolveProviderFromGroup(db, group);
      expect(result?.externalProviderArrangementInstanceReference).toBe('A');
    });

    it('returns the primary (lowest priority) when all members are unreachable', async () => {
      const db = makeDb([
        { externalProviderArrangementInstanceReference: 'C', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'unreachable' },
        { externalProviderArrangementInstanceReference: 'A', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'unreachable' },
      ]);
      const group = makeGroup('primary_fallback', [member('A', 10), member('C', 5)]);
      const result = await resolveProviderFromGroup(db, group);
      // Fallback path fetches the primary (priority 5 = C) without the status filter.
      expect(result?.externalProviderArrangementInstanceReference).toBe('C');
    });
  });

  describe('round_robin', () => {
    it('rotates across active members on successive calls', async () => {
      const db = makeDb([
        { externalProviderArrangementInstanceReference: 'A', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'ok' },
        { externalProviderArrangementInstanceReference: 'B', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'ok' },
      ]);
      // Unique ref so the module-level round-robin counter is isolated for this test.
      const group = makeGroup('round_robin', [member('A', 10), member('B', 20)], 'grp-rr-unique-1');
      const r1 = await resolveProviderFromGroup(db, group);
      const r2 = await resolveProviderFromGroup(db, group);
      const r3 = await resolveProviderFromGroup(db, group);
      expect([
        r1?.externalProviderArrangementInstanceReference,
        r2?.externalProviderArrangementInstanceReference,
        r3?.externalProviderArrangementInstanceReference,
      ]).toEqual(['A', 'B', 'A']);
    });
  });

  describe('default (weighted / other strategies)', () => {
    it('returns the first active member by priority', async () => {
      const db = makeDb([
        { externalProviderArrangementInstanceReference: 'A', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'ok' },
        { externalProviderArrangementInstanceReference: 'C', externalProviderArrangementStatus: 'active', externalProviderHealthStatus: 'ok' },
      ]);
      const group = makeGroup('weighted', [member('A', 10), member('C', 5)]);
      const result = await resolveProviderFromGroup(db, group);
      expect(result?.externalProviderArrangementInstanceReference).toBe('C');
    });
  });
});

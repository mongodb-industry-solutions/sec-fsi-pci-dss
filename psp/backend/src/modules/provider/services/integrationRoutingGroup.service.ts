import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION,
  EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION,
  IntegrationRoutingGroup,
  RoutingStrategy,
  IntegrationProviderType,
  ExternalProviderArrangement,
} from '../models/externalProviderArrangement.model';
import { bianMetaFor } from './integrationRegistry.service';

// Rolling counter for round_robin: in-memory, resets on restart (acceptable for demo)
const roundRobinCounters: Record<string, number> = {};

export interface CreateRoutingGroupInput {
  name: string;
  providerType: IntegrationProviderType;
  strategy: RoutingStrategy;
}

export async function createRoutingGroup(
  db: Db,
  input: CreateRoutingGroupInput
): Promise<IntegrationRoutingGroup> {
  const id = uuidv4();
  const now = new Date();
  const bianMeta = bianMetaFor(input.providerType);

  const group: IntegrationRoutingGroup = {
    routingGroupInstanceReference: id,
    routingGroupName: input.name,
    routingGroupProviderType: input.providerType,
    routingGroupStrategy: input.strategy,
    routingGroupStatus: 'active',
    routingGroupMembers: [],
    isDefaultGroup: false,
    bianServiceDomain: bianMeta.domain,
    bianControlRecordType: 'ExternalProviderArrangementPortfolio',
    pciDssRequirements: bianMeta.pciDss,
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
  };

  await db.collection<IntegrationRoutingGroup>(EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION).insertOne(group);
  return group;
}

export async function getRoutingGroup(
  db: Db,
  id: string
): Promise<IntegrationRoutingGroup | null> {
  return db.collection<IntegrationRoutingGroup>(EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION)
    .findOne({ routingGroupInstanceReference: id });
}

export async function listRoutingGroups(
  db: Db,
  filter?: { type?: IntegrationProviderType }
): Promise<IntegrationRoutingGroup[]> {
  const query: Record<string, unknown> = {};
  if (filter?.type) query['routingGroupProviderType'] = filter.type;
  return db.collection<IntegrationRoutingGroup>(EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION)
    .find(query)
    .sort({ isDefaultGroup: -1, recordCreatedDateTime: 1 })
    .toArray();
}

export async function updateRoutingGroup(
  db: Db,
  id: string,
  patch: Partial<Pick<IntegrationRoutingGroup, 'routingGroupName' | 'routingGroupStrategy' | 'routingGroupStatus'>>
): Promise<IntegrationRoutingGroup | null> {
  return db.collection<IntegrationRoutingGroup>(EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION).findOneAndUpdate(
    { routingGroupInstanceReference: id },
    { $set: { ...patch, recordUpdatedDateTime: new Date() } },
    { returnDocument: 'after' }
  );
}

export async function getDefaultGroupForType(
  db: Db,
  type: IntegrationProviderType
): Promise<IntegrationRoutingGroup | null> {
  return db.collection<IntegrationRoutingGroup>(EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION).findOne({
    routingGroupProviderType: type,
    isDefaultGroup: true,
  });
}

export async function addMemberToGroup(
  db: Db,
  groupId: string,
  providerId: string,
  priority = 100,
  weight?: number,
  role?: 'primary' | 'fallback' | 'peer'
): Promise<IntegrationRoutingGroup | null> {
  const group = await getRoutingGroup(db, groupId);
  if (!group) return null;

  // Prevent duplicate membership
  const alreadyMember = group.routingGroupMembers.some(
    m => m.externalProviderArrangementInstanceReference === providerId
  );
  if (!alreadyMember) {
    // Role: explicit override, or primary if no external (non-internal) members exist yet
    const hasExternalMembers = group.routingGroupMembers.some(m => m.memberPriority < 999);
    const assignedRole = role ?? (hasExternalMembers ? 'fallback' : 'primary');
    await db.collection<IntegrationRoutingGroup>(EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION).updateOne(
      { routingGroupInstanceReference: groupId },
      {
        $push: {
          routingGroupMembers: {
            externalProviderArrangementInstanceReference: providerId,
            memberPriority: priority,
            memberWeight: weight,
            memberRole: assignedRole,
          },
        },
        $set: { recordUpdatedDateTime: new Date() },
      }
    );
  }

  // Update provider's routingGroupId and priority
  await db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION).updateOne(
    { externalProviderArrangementInstanceReference: providerId },
    { $set: { routingGroupId: groupId, routingPriority: priority, routingWeight: weight, recordUpdatedDateTime: new Date() } }
  );

  return getRoutingGroup(db, groupId);
}

export async function removeMemberFromGroup(
  db: Db,
  groupId: string,
  providerId: string
): Promise<IntegrationRoutingGroup | null> {
  await db.collection<IntegrationRoutingGroup>(EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION).updateOne(
    { routingGroupInstanceReference: groupId },
    {
      $pull: { routingGroupMembers: { externalProviderArrangementInstanceReference: providerId } as never },
      $set: { recordUpdatedDateTime: new Date() },
    }
  );

  // Clear provider's routing group reference
  await db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION).updateOne(
    { externalProviderArrangementInstanceReference: providerId },
    { $unset: { routingGroupId: '' }, $set: { recordUpdatedDateTime: new Date() } }
  );

  return getRoutingGroup(db, groupId);
}

export interface DeleteRoutingGroupResult {
  ok: boolean;
  reason?: 'not_found' | 'is_default';
}

// Delete a routing group and detach its members (clear their routingGroupId). The default
// group for a provider type cannot be deleted: it is the fallback target for dispatch.
export async function deleteRoutingGroup(
  db: Db,
  groupId: string
): Promise<DeleteRoutingGroupResult> {
  const group = await getRoutingGroup(db, groupId);
  if (!group) return { ok: false, reason: 'not_found' };
  if (group.isDefaultGroup) return { ok: false, reason: 'is_default' };

  const memberIds = group.routingGroupMembers.map(m => m.externalProviderArrangementInstanceReference);
  if (memberIds.length > 0) {
    await db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION).updateMany(
      { externalProviderArrangementInstanceReference: { $in: memberIds } },
      { $unset: { routingGroupId: '' }, $set: { recordUpdatedDateTime: new Date() } }
    );
  }
  await db.collection<IntegrationRoutingGroup>(EXTERNAL_PROVIDER_ARRANGEMENT_PORTFOLIO_COLLECTION)
    .deleteOne({ routingGroupInstanceReference: groupId });
  return { ok: true };
}

// Resolve which provider to use given a routing group strategy
export async function resolveProviderFromGroup(
  db: Db,
  group: IntegrationRoutingGroup
): Promise<ExternalProviderArrangement | null> {
  if (group.routingGroupMembers.length === 0) return null;

  // Sort members by priority (lower = higher priority)
  const sorted = [...group.routingGroupMembers].sort((a, b) => a.memberPriority - b.memberPriority);

  if (group.routingGroupStrategy === 'primary_fallback') {
    // Try each in priority order, skip unreachable ones
    for (const member of sorted) {
      const provider = await db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION).findOne({
        externalProviderArrangementInstanceReference: member.externalProviderArrangementInstanceReference,
        externalProviderArrangementStatus: 'active',
      });
      if (provider && provider.externalProviderHealthStatus !== 'unreachable') {
        return provider;
      }
    }
    // If all are unreachable, return primary anyway
    const primary = sorted[0];
    return db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION).findOne({
      externalProviderArrangementInstanceReference: primary.externalProviderArrangementInstanceReference,
    });
  }

  if (group.routingGroupStrategy === 'round_robin') {
    const counter = roundRobinCounters[group.routingGroupInstanceReference] ?? 0;
    const active = sorted.filter(m => true); // all members participate
    const selected = active[counter % active.length];
    roundRobinCounters[group.routingGroupInstanceReference] = (counter + 1) % active.length;
    return db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION).findOne({
      externalProviderArrangementInstanceReference: selected.externalProviderArrangementInstanceReference,
      externalProviderArrangementStatus: 'active',
    });
  }

  // Default: return first active member
  const first = sorted[0];
  return db.collection<ExternalProviderArrangement>(EXTERNAL_PROVIDER_ARRANGEMENT_COLLECTION).findOne({
    externalProviderArrangementInstanceReference: first.externalProviderArrangementInstanceReference,
    externalProviderArrangementStatus: 'active',
  });
}

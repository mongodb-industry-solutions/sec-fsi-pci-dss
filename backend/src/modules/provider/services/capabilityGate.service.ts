// v29 capability gate (ADR-029, EDA + Hexagonal). A built-in module is the INTERNAL fallback
// adapter of a capability port. Its administration surface (v29 cards*/accounts* routes) only makes
// sense, and is only enabled, WHEN the capability's provider group resolves to the internal provider.
// If an external provider has taken over the group (a member with priority < 999, active + reachable),
// the built-in module is no longer in use and its administration is disabled with 409 managed_externally.
//
// Resolution mirrors dispatch: getActiveProviderForType (internal-first) → if the winner belongs to a
// routing group, resolveProviderFromGroup applies the configured strategy (primary_fallback orders by
// memberPriority ASC, so an active/reachable external member outranks the internal 999 fallback).

import { Db } from 'mongodb';
import { FastifyReply, FastifyRequest, FastifyInstance } from 'fastify';
import {
  IntegrationProviderType,
  ExternalProviderArrangement,
} from '../models/externalProviderArrangement.model';
import { getActiveProviderForType } from './integrationRegistry.service';
import { getRoutingGroup, resolveProviderFromGroup } from './integrationRoutingGroup.service';

// Resolve the provider that would actually serve this capability right now (routing-group aware).
export async function resolveEffectiveProvider(
  db: Db,
  type: IntegrationProviderType,
): Promise<ExternalProviderArrangement | null> {
  const provider = await getActiveProviderForType(db, type);
  if (!provider) return null;
  if (provider.routingGroupId) {
    const group = await getRoutingGroup(db, provider.routingGroupId);
    if (group) {
      const resolved = await resolveProviderFromGroup(db, group);
      if (resolved) return resolved;
    }
  }
  return provider;
}

// True when the capability currently resolves to its internal built-in provider (fallback at 999).
export async function assertCapabilityIsInternal(
  db: Db,
  type: IntegrationProviderType,
): Promise<boolean> {
  const effective = await resolveEffectiveProvider(db, type);
  return effective?.externalProviderIsInternal === true;
}

// Reusable Fastify preHandler: 409 managed_externally when an external provider owns the capability.
// R4 materialization. Logs a `warn` (Canal B, §8) so the operator understands WHY admin is disabled;
// emits no compliance event (a 409 is not data access).
export function requireInternalProvider(type: IntegrationProviderType) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const db = (request.server as FastifyInstance & { db: Db }).db;
    const internal = await assertCapabilityIsInternal(db, type);
    if (!internal) {
      request.log.warn(
        { capability: type, gate: 'managed_externally' },
        'v29 admin route disabled: capability resolves to an external provider',
      );
      return reply.status(409).send({
        error: 'managed_externally',
        capability: type,
        message: 'This resource is managed by an external provider; built-in administration is disabled.',
      });
    }
  };
}

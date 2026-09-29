// capabilityModuleConfiguration (dev.v7 plan, ADR-029): the DB-backed configuration of each
// internal **Module** (the engine that implements a capability when no external vendor is active).
// A Module is NOT a vendor: the vendor is connection config; the Module executes logic and, after
// processing, calls back the PSP at the route held here (`moduleCallbackEndpoints`). See plan §1.2.
//
// One document per capability that has an internal Module (the 8 in capabilities.ts; `generic` has
// none). Lives in the providers module for now; the engine code itself lives in its domain module
// (fraud/customer/gateway): Fase 4 seeds the documents and wires the engines.

export const CAPABILITY_MODULE_CONFIGURATION_COLLECTION = 'capabilityModuleConfiguration';

export type CapabilityModuleStatus = 'active' | 'suspended';
export type CapabilityModuleDomain = 'fraud' | 'customer' | 'gateway';

export interface CapabilityModuleCallbackEndpoint {
  event: string;   // e.g. 'fds.scored', 'hrp.screened'
  path: string;    // PSP route the Module calls back, e.g. /api/v1/providers/callback/fds/:id
}

export interface CapabilityModuleConfiguration {
  capabilityModuleInstanceReference: string;   // = capability key (PK), e.g. 'fds'
  capability: string;                           // canonical capability key
  moduleDomain: CapabilityModuleDomain;         // owning code module
  capabilityModuleStatus: CapabilityModuleStatus;
  // Internal engine settings (thresholds / rules / scoring params): shape varies per capability.
  moduleConfig: Record<string, unknown>;
  // Which PSP callback route(s) the engine invokes after processing (round-trip, plan §1.2).
  moduleCallbackEndpoints: CapabilityModuleCallbackEndpoint[];
  bianServiceDomain: string;
  bianControlRecordType: string;
  pciDssRequirements: string[];
  recordCreatedDateTime: Date;
  recordUpdatedDateTime: Date;
}

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  BUSINESS_PROCESS_EVENTS_COLLECTION,
  COMPLIANCE_PROCESS_EVENTS_COLLECTION,
  BusinessProcessEvent,
  BusinessProcessType,
  ComplianceProcessType,
  BusinessEntityType,
  ProcessEventOutcome,
  ProcessEventMeta,
} from '../models/externalProviderArrangement.model';

// CHD blocklist — these keys must never appear in eventSummary (PCI DSS Req 3.2 / ADR-014)
const CHD_BLOCKLIST = new Set([
  'pan', 'cardNumber', 'cvv', 'cvv2', 'cvc', 'cvc2',
  'expiryDate', 'cardExpiry', 'expiry', 'cardholderName',
  'trackData', 'track1', 'track2', 'track3', 'pinBlock',
  'fullCardNumber', 'primaryAccountNumber',
]);

function sanitizeSummary(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(raw).filter(([k]) => !CHD_BLOCKLIST.has(k))
  );
}

interface EmitProcessEventOpts {
  entityType: BusinessEntityType;
  entityId: string;
  processType: BusinessProcessType;
  processAction: string;
  processOutcome: ProcessEventOutcome;
  performedByPartyReference: string | null;
  performedByRole: string | null;
  eventSummary: Record<string, unknown>;
  bianServiceDomain: string;
  bianControlRecordType: string;
  processMeta?: ProcessEventMeta;
}

interface EmitComplianceEventOpts {
  entityType: BusinessEntityType;
  entityId: string;
  processType: ComplianceProcessType;
  processAction: string;
  processOutcome: ProcessEventOutcome;
  performedByPartyReference: string | null;
  performedByRole: string | null;
  eventSummary: Record<string, unknown>;
  bianServiceDomain: string;
  bianControlRecordType: string;
  processMeta?: ProcessEventMeta;
}

// Fire-and-forget — never blocks request path (PCI DSS Req 10.2.1)
export function emitProcessEvent(db: Db, opts: EmitProcessEventOpts): void {
  const event: BusinessProcessEvent = {
    eventDateTime: new Date(),
    processType: opts.processType,
    businessProcessEventInstanceReference: uuidv4(),
    entityType: opts.entityType,
    entityId: opts.entityId,
    processAction: opts.processAction,
    processOutcome: opts.processOutcome,
    performedByPartyReference: opts.performedByPartyReference,
    performedByRole: opts.performedByRole,
    eventSummary: sanitizeSummary(opts.eventSummary),
    bianServiceDomain: opts.bianServiceDomain,
    bianControlRecordType: opts.bianControlRecordType,
    processMeta: opts.processMeta,
  };
  try {
    void db.collection<BusinessProcessEvent>(BUSINESS_PROCESS_EVENTS_COLLECTION).insertOne(event).catch(() => {});
  } catch { /* fire-and-forget: swallow synchronous errors (e.g. test mocks) */ }
}

export function emitComplianceEvent(db: Db, opts: EmitComplianceEventOpts): void {
  const event: BusinessProcessEvent = {
    eventDateTime: new Date(),
    processType: opts.processType,
    businessProcessEventInstanceReference: uuidv4(),
    entityType: opts.entityType,
    entityId: opts.entityId,
    processAction: opts.processAction,
    processOutcome: opts.processOutcome,
    performedByPartyReference: opts.performedByPartyReference,
    performedByRole: opts.performedByRole,
    eventSummary: sanitizeSummary(opts.eventSummary),
    bianServiceDomain: opts.bianServiceDomain,
    bianControlRecordType: opts.bianControlRecordType,
    processMeta: opts.processMeta,
  };
  try {
    void db.collection<BusinessProcessEvent>(COMPLIANCE_PROCESS_EVENTS_COLLECTION).insertOne(event).catch(() => {});
  } catch { /* fire-and-forget: swallow synchronous errors (e.g. test mocks) */ }
}

export async function listProcessEvents(
  db: Db,
  opts: {
    processType?: BusinessProcessType;
    entityType?: BusinessEntityType;
    entityId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }
): Promise<{ events: BusinessProcessEvent[]; total: number; page: number; limit: number }> {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 20, 100);
  const query: Record<string, unknown> = {};
  if (opts.processType) query.processType = opts.processType;
  if (opts.entityType)  query.entityType  = opts.entityType;
  if (opts.entityId)    query.entityId    = opts.entityId;
  if (opts.from || opts.to) {
    const dateFilter: Record<string, Date> = {};
    if (opts.from) dateFilter.$gte = opts.from;
    if (opts.to)   dateFilter.$lte = opts.to;
    query.eventDateTime = dateFilter;
  }

  const col = db.collection<BusinessProcessEvent>(BUSINESS_PROCESS_EVENTS_COLLECTION);
  const [events, total] = await Promise.all([
    col.find(query).sort({ eventDateTime: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(query),
  ]);
  return { events, total, page, limit };
}

export async function listComplianceEvents(
  db: Db,
  opts: {
    processType?: ComplianceProcessType;
    entityType?: BusinessEntityType;
    entityId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }
): Promise<{ events: BusinessProcessEvent[]; total: number; page: number; limit: number }> {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 20, 100);
  const query: Record<string, unknown> = {};
  if (opts.processType) query.processType = opts.processType;
  if (opts.entityType)  query.entityType  = opts.entityType;
  if (opts.entityId)    query.entityId    = opts.entityId;
  if (opts.from || opts.to) {
    const dateFilter: Record<string, Date> = {};
    if (opts.from) dateFilter.$gte = opts.from;
    if (opts.to)   dateFilter.$lte = opts.to;
    query.eventDateTime = dateFilter;
  }

  const col = db.collection<BusinessProcessEvent>(COMPLIANCE_PROCESS_EVENTS_COLLECTION);
  const [events, total] = await Promise.all([
    col.find(query).sort({ eventDateTime: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(query),
  ]);
  return { events, total, page, limit };
}

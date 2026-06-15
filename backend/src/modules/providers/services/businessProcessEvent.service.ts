import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  BUSINESS_PROCESS_EVENTS_COLLECTION,
  COMPLIANCE_PROCESS_EVENTS_COLLECTION,
  EXTERNAL_PROVIDER_ARRANGEMENT_ACTION_LOG_COLLECTION,
  BusinessProcessEvent,
  IntegrationEvent,
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

// Recursive CHD scrub for payload snapshots stored in the audit trail. Strips blocklisted
// keys at ANY depth (payloads can be nested, e.g. card.cvv) so the stored snapshot is safe
// to display (PCI DSS Req 3.2) while preserving the rest of the data for analysis/replay.
export function sanitizeDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !CHD_BLOCKLIST.has(k))
        .map(([k, v]) => [k, sanitizeDeep(v)])
    );
  }
  return value;
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

// ── Unified audit view ──────────────────────────────────────────────────────
// Normalized row across the three event sources so manager/auditor can audit the whole
// system in one place: business process events, compliance events, and integration
// (inbound/outbound test + dispatch/callback) events.
export type AuditSource = 'business' | 'compliance' | 'integration';
export interface AuditEventRow {
  id: string;
  source: AuditSource;
  eventDateTime: Date;
  type: string;
  action: string;
  outcome: string;
  entityType?: string;
  entityId?: string;
  performedByRole?: string | null;
  bianServiceDomain?: string;
  context?: string;
  summary?: Record<string, unknown>;
}

const AUDIT_FETCH_CAP = 1000; // per-source bound for the in-memory merge (demo volumes)

export async function listAuditEvents(
  db: Db,
  opts: {
    source?: AuditSource | 'all';
    type?: string;
    entityType?: string;
    outcome?: string;
    q?: string;
    // Deep "related reference" match across entityId + event summary/payload — used by the auditor to
    // find EVERY event for a given transaction id / case id / merchant / customer / card token.
    ref?: string;
    minScore?: number;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }
): Promise<{ events: AuditEventRow[]; total: number; page: number; limit: number; capped: boolean }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(opts.limit ?? 20, 100);
  const source = opts.source ?? 'all';

  const dateClause: Record<string, Date> = {};
  if (opts.from) dateClause.$gte = opts.from;
  if (opts.to) dateClause.$lte = opts.to;
  const hasDate = !!(opts.from || opts.to);

  const rows: AuditEventRow[] = [];
  let capped = false;

  // Business + compliance process events (shared shape)
  for (const [src, coll] of [
    ['business', BUSINESS_PROCESS_EVENTS_COLLECTION] as const,
    ['compliance', COMPLIANCE_PROCESS_EVENTS_COLLECTION] as const,
  ]) {
    if (source !== 'all' && source !== src) continue;
    const query: Record<string, unknown> = {};
    if (opts.type) query.processType = opts.type;
    if (hasDate) query.eventDateTime = dateClause;
    const docs = await db.collection<BusinessProcessEvent>(coll)
      .find(query).sort({ eventDateTime: -1 }).limit(AUDIT_FETCH_CAP + 1).toArray();
    if (docs.length > AUDIT_FETCH_CAP) capped = true;
    for (const d of docs.slice(0, AUDIT_FETCH_CAP)) {
      rows.push({
        id: d.businessProcessEventInstanceReference,
        source: src,
        eventDateTime: d.eventDateTime,
        type: d.processType,
        action: d.processAction,
        outcome: d.processOutcome,
        entityType: d.entityType,
        entityId: d.entityId,
        performedByRole: d.performedByRole,
        bianServiceDomain: d.bianServiceDomain,
        summary: d.eventSummary,
      });
    }
  }

  // Integration events (inbound/outbound test, dispatch, callback)
  if (source === 'all' || source === 'integration') {
    const query: Record<string, unknown> = {};
    if (opts.type) query.integrationEventType = opts.type;
    if (hasDate) query.recordCreatedDateTime = dateClause;
    const docs = await db.collection<IntegrationEvent>(EXTERNAL_PROVIDER_ARRANGEMENT_ACTION_LOG_COLLECTION)
      .find(query).sort({ recordCreatedDateTime: -1 }).limit(AUDIT_FETCH_CAP + 1).toArray();
    if (docs.length > AUDIT_FETCH_CAP) capped = true;
    for (const d of docs.slice(0, AUDIT_FETCH_CAP)) {
      const meta = (d.integrationEventMeta ?? {}) as Record<string, unknown>;
      // Use the business context (e.g. the transaction this callback belongs to) for entity linking
      // and search, so an integration event is findable by its transaction/case id — not only by the
      // provider id. The provider arrangement id is retained in the summary.
      rows.push({
        id: d.integrationEventInstanceReference,
        source: 'integration',
        eventDateTime: d.recordCreatedDateTime,
        type: d.integrationEventType,
        action: d.integrationEventTriggeredBy,
        outcome: d.integrationEventStatus,
        entityType: d.businessContext?.entityType ?? 'integration',
        entityId: d.businessContext?.entityId ?? d.externalProviderArrangementInstanceReference,
        performedByRole: null,
        bianServiceDomain: d.bianServiceDomain,
        context: typeof meta.direction === 'string' ? `${meta.direction}${meta.test ? ' test' : ''}` : undefined,
        summary: {
          providerArrangementId: d.externalProviderArrangementInstanceReference,
          payload: d.integrationEventPayloadSnapshot,
          payloadHash: d.integrationEventPayloadHash,
          responseCode: d.integrationEventResponseCode,
          latencyMs: d.integrationEventLatencyMs,
          error: d.integrationEventErrorMessage,
          request: d.integrationEventRequest,
          response: d.integrationEventResponse,
          ...meta,
        },
      });
    }
  }

  // In-memory narrowing (entity, outcome, risk score, free-text), merge-sort, paginate
  let merged = rows;
  if (opts.entityType) merged = merged.filter((r) => r.entityType === opts.entityType);
  if (opts.outcome) merged = merged.filter((r) => r.outcome === opts.outcome);
  if (opts.minScore !== undefined) {
    merged = merged.filter((r) => {
      const s = (r.summary as { score?: unknown } | undefined)?.score;
      return typeof s === 'number' && s >= (opts.minScore as number);
    });
  }
  if (opts.q) {
    const q = opts.q.toLowerCase();
    merged = merged.filter((r) =>
      r.action.toLowerCase().includes(q) ||
      (r.entityId ?? '').toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q));
  }
  // Deep "related reference" match: entityId OR any value in the event summary/payload (so a txn id,
  // case id, merchant id, customer/account ref or card token finds EVERY related event).
  if (opts.ref) {
    const ref = opts.ref.toLowerCase().trim();
    merged = merged.filter((r) => {
      if ((r.entityId ?? '').toLowerCase().includes(ref)) return true;
      try { return JSON.stringify(r.summary ?? {}).toLowerCase().includes(ref); } catch { return false; }
    });
  }
  merged.sort((a, b) => new Date(b.eventDateTime).getTime() - new Date(a.eventDateTime).getTime());
  const total = merged.length;
  const events = merged.slice((page - 1) * limit, page * limit);
  return { events, total, page, limit, capped };
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

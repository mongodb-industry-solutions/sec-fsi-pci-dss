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

// CHD scrubbing is owned by the eventbus vendor (single source of truth, PCI DSS Req 3.2 / ADR-014).
// Re-exported here so existing importers keep working unchanged.
import { sanitizeDeep } from '../../../vendors/eventbus/sanitize';
export { sanitizeDeep };
import { getEventBus, makeEvent, type BusinessProcess, type EventBus, type DomainEvent } from '../../../vendors/eventbus';

// Maps the per-event processType to the EDA business-process class used to group a journey (dev.v8).
export const PROCESS_TO_BUSINESS: Record<string, BusinessProcess> = {
  payment_processing: 'card_payment',
  card_authorization: 'card_payment',
  fraud_evaluation: 'fraud_investigation',
  aml_screening: 'fraud_investigation',
  kyc_verification: 'customer_onboarding',
  kyb_verification: 'merchant_onboarding',
  merchant_onboarding: 'merchant_onboarding',
  customer_onboarding: 'customer_onboarding',
  card_management: 'card_management',
};

// Mirror an event onto the unified, correlated event store (dev.v8 F2): a journey (correlationId)
// becomes traceable end-to-end. Best-effort; if the bus is not initialized (unit tests / degraded
// mode) it is a silent no-op. CHD is stripped on publish. Shared by the emitters and the dispatcher.
export function mirrorEventToBus(input: {
  eventType: string; correlationId: string; businessProcess: BusinessProcess; source: string;
  payload: Record<string, unknown>;
  actor?: { partyRef?: string | null; role?: string | null };
  bian?: { serviceDomain: string; controlRecord: string };
}): void {
  try { void getEventBus().publish(makeEvent(input)); } catch { /* bus not initialized */ }
}

// §9.2: publish-then-project. Publishes a ledger-bearing domain event; the LedgerProjection subscriber
// writes the durable ledger row. `ledgerKind` selects business vs compliance; processType + processMeta
// ride the payload so the projector can reconstruct the row. CHD is stripped by the bus on publish.
function publishLedgerEvent(opts: EmitProcessEventOpts | EmitComplianceEventOpts, ledgerKind: 'business' | 'compliance'): void {
  mirrorEventToBus({
    eventType: opts.processAction,
    correlationId: opts.entityId,
    businessProcess: PROCESS_TO_BUSINESS[opts.processType] ?? 'system',
    source: 'psp.core',
    payload: {
      ...opts.eventSummary,
      outcome: opts.processOutcome,
      entityType: opts.entityType,
      processType: opts.processType,
      ledgerKind,
      ...(opts.processMeta ? { processMeta: opts.processMeta } : {}),
    },
    actor: { partyRef: opts.performedByPartyReference, role: opts.performedByRole },
    bian: { serviceDomain: opts.bianServiceDomain, controlRecord: opts.bianControlRecordType },
  });
}

// Payload keys that carry projection metadata (not part of the ledger eventSummary).
const LEDGER_META_KEYS = new Set(['outcome', 'entityType', 'processType', 'ledgerKind', 'processMeta']);

// §5.0 / §9.2: the durable audit ledger is a PROJECTION written by this single bus subscriber from the
// published domain events — it never originates events. Business logic only publishes (via emit*).
export class LedgerProjection {
  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  register(): void {
    this.bus.subscribe('*', (e) => this.project(e));
  }

  private async project(e: DomainEvent): Promise<void> {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const kind = p.ledgerKind;
    if (kind !== 'business' && kind !== 'compliance') return; // only emit*-originated ledger events
    const collection = kind === 'business' ? BUSINESS_PROCESS_EVENTS_COLLECTION : COMPLIANCE_PROCESS_EVENTS_COLLECTION;
    const eventSummary: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) if (!LEDGER_META_KEYS.has(k)) eventSummary[k] = v;
    const row: BusinessProcessEvent = {
      eventDateTime: new Date(e.occurredAt),
      processType: p.processType as BusinessProcessType,
      businessProcessEventInstanceReference: uuidv4(),
      entityType: p.entityType as BusinessEntityType,
      entityId: e.correlationId,
      processAction: e.eventType,
      processOutcome: p.outcome as ProcessEventOutcome,
      performedByPartyReference: e.actor?.partyRef ?? null,
      performedByRole: e.actor?.role ?? null,
      eventSummary,
      bianServiceDomain: e.bian?.serviceDomain ?? '',
      bianControlRecordType: e.bian?.controlRecord ?? '',
      processMeta: p.processMeta as ProcessEventMeta | undefined,
    };
    try { await this.db.collection<BusinessProcessEvent>(collection).insertOne(row); } catch { /* fire-and-forget */ }
  }
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

// §9.2 flip — publish-then-project. Business logic publishes the domain event; the LedgerProjection
// bus subscriber writes the businessProcessEvent/complianceProcessEvent ledger. No direct write here
// (the legacy write-then-mirror double-write is gone). Fire-and-forget; never blocks (PCI Req 10.2.1).
// `_db` is retained for call-site compatibility but unused — the projection owns the DB write.
export function emitProcessEvent(_db: Db, opts: EmitProcessEventOpts): void {
  publishLedgerEvent(opts, 'business');
}

export function emitComplianceEvent(_db: Db, opts: EmitComplianceEventOpts): void {
  publishLedgerEvent(opts, 'compliance');
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

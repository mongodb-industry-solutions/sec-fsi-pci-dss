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

// CHD scrubbing is owned by the eventbus vendor (single source of truth, PCI DSS / ADR-014).
// Re-exported here so existing importers keep working unchanged.
import { sanitizeDeep } from '../../../vendors/eventbus';
export { sanitizeDeep };
import { getEventBus, makeEvent, type BusinessProcess, type EventBus, type DomainEvent } from '../../../vendors/eventbus';
import { CUSTOMER_AUTHENTICATION_COLLECTION, CustomerAuthenticationAssessmentRecord } from '../../identity/models/customerAuthentication.model';

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
      // v18: activity attribution (rides the payload; projected out of eventSummary in buildRow).
      ...(opts.attribution ? { attribution: opts.attribution } : {}),
    },
    actor: { partyRef: opts.performedByPartyReference, role: opts.performedByRole },
    bian: { serviceDomain: opts.bianServiceDomain, controlRecord: opts.bianControlRecordType },
  });
}

// Payload keys that carry projection metadata (not part of the ledger eventSummary).
const LEDGER_META_KEYS = new Set(['outcome', 'entityType', 'processType', 'ledgerKind', 'processMeta', 'chd', 'attribution']);

// P13.4 (§5): canonical choreography milestones are published directly on the bus (not via emit*), so
// they carry no `ledgerKind`. The projection ALSO writes them to the business ledger so the unified
// audit view shows the journey open/close and EVERY gate *.completed symmetrically (no more missing
// fds/hrp completions, no issuer-only asymmetry). The wire detail stays in the integration action-log.
const CANONICAL_LEDGER_EVENTS: Record<string, { processType: BusinessProcessType; entityType: BusinessEntityType; bian: { serviceDomain: string; controlRecord: string } }> = {
  'card.payment.authorization.requested': { processType: 'payment_processing', entityType: 'transaction', bian: { serviceDomain: 'SD-254 Card Transaction', controlRecord: 'CardTransactionRecord' } },
  'card.payment.authorization.completed': { processType: 'payment_processing', entityType: 'transaction', bian: { serviceDomain: 'SD-254 Card Transaction', controlRecord: 'CardTransactionRecord' } },
  'card.issuer.validation.completed':     { processType: 'payment_processing', entityType: 'transaction', bian: { serviceDomain: 'SD-88 Payment Card', controlRecord: 'PaymentCardValidation' } },
  'fds.scoring.completed':                { processType: 'fraud_evaluation',   entityType: 'transaction', bian: { serviceDomain: 'SD-63 Fraud Evaluation', controlRecord: 'FraudEvaluationAssessment' } },
  'hrp.screening.completed':              { processType: 'aml_screening',      entityType: 'transaction', bian: { serviceDomain: 'SD-13 Party Reference', controlRecord: 'PartyReferenceDataDirectoryEntry' } },
  'aml.monitoring.completed':             { processType: 'aml_screening',      entityType: 'transaction', bian: { serviceDomain: 'SD-99 AML', controlRecord: 'SuspiciousActivityAnalysisAssessment' } },
  'p2p.transfer.completed':               { processType: 'payment_processing', entityType: 'transaction', bian: { serviceDomain: 'Payment Execution', controlRecord: 'PaymentExecutionProcedure' } },
  'vop.verification.completed':           { processType: 'aml_screening',      entityType: 'payment_request', bian: { serviceDomain: 'SD-13 Party Data Management', controlRecord: 'PartyReferenceDataDirectoryEntry' } },
  // v31 KYB onboarding chain (§5bis): entity-level screening milestones, keyed by merchantAgreementRef
  // (correlationId). processType tags them under aml_screening for the ledger; the processAction (event
  // name) is the real label. entityType 'merchant' so they surface in the merchant KYB process timeline.
  'kyb.screening.completed':              { processType: 'sanctions_check',    entityType: 'merchant', bian: { serviceDomain: 'SD-89 Merchant Relations', controlRecord: 'MerchantAgreementProcedure' } },
  'aml.screening.completed':              { processType: 'aml_screening',      entityType: 'merchant', bian: { serviceDomain: 'SD-99 AML', controlRecord: 'SuspiciousActivityAnalysisAssessment' } },
  'kyb.verification.completed':           { processType: 'sanctions_check',    entityType: 'merchant', bian: { serviceDomain: 'SD-89 Merchant Relations', controlRecord: 'MerchantAgreementProcedure' } },
};

// §5.0 / §9.2: the durable audit ledger is a PROJECTION written by this single bus subscriber from the
// published domain events: it never originates events. Business logic only publishes (via emit*).
export class LedgerProjection {
  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  register(): void {
    this.bus.subscribe('*', (e) => this.project(e));
  }

  private async project(e: DomainEvent): Promise<void> {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const kind = p.ledgerKind;

    // emit*-originated ledger events carry an explicit ledgerKind.
    if (kind === 'business' || kind === 'compliance') {
      const collection = kind === 'business' ? BUSINESS_PROCESS_EVENTS_COLLECTION : COMPLIANCE_PROCESS_EVENTS_COLLECTION;
      const row = this.buildRow(e, p, p.processType as BusinessProcessType, p.entityType as BusinessEntityType, e.correlationId,
        e.bian?.serviceDomain ?? '', e.bian?.controlRecord ?? '');
      try { await this.db.collection<BusinessProcessEvent>(collection).insertOne(row); } catch { /* fire-and-forget */ }
      return;
    }

    // P13.4: canonical §5 milestone (no ledgerKind) → project to the business ledger so the audit view
    // shows the whole journey symmetrically. `transient` aggregation events are still ignored.
    const milestone = CANONICAL_LEDGER_EVENTS[e.eventType];
    if (!milestone || e.transient) return;
    const row = this.buildRow(e, p, milestone.processType, milestone.entityType, e.correlationId,
      e.bian?.serviceDomain ?? milestone.bian.serviceDomain, e.bian?.controlRecord ?? milestone.bian.controlRecord);
    try { await this.db.collection<BusinessProcessEvent>(BUSINESS_PROCESS_EVENTS_COLLECTION).insertOne(row); } catch { /* fire-and-forget */ }
  }

  private buildRow(
    e: DomainEvent, p: Record<string, unknown>, processType: BusinessProcessType, entityType: BusinessEntityType,
    entityId: string, bianServiceDomain: string, bianControlRecordType: string,
  ): BusinessProcessEvent {
    const eventSummary: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) if (!LEDGER_META_KEYS.has(k)) eventSummary[k] = v;
    const attr = (p.attribution ?? {}) as EventActivityAttribution;
    return {
      eventDateTime: new Date(e.occurredAt),
      processType,
      businessProcessEventInstanceReference: uuidv4(),
      entityType,
      entityId,
      processAction: e.eventType,
      processOutcome: (p.outcome as ProcessEventOutcome) ?? 'pending',
      performedByPartyReference: e.actor?.partyRef ?? null,
      performedByRole: e.actor?.role ?? null,
      eventSummary,
      bianServiceDomain,
      bianControlRecordType,
      processMeta: p.processMeta as ProcessEventMeta | undefined,
      ...(attr.clientId && { clientId: attr.clientId }),
      ...(attr.merchantAgreementReference && { merchantAgreementReference: attr.merchantAgreementReference }),
      ...(attr.actingPartyReference && { actingPartyReference: attr.actingPartyReference }),
      ...(attr.actingChannel && { actingChannel: attr.actingChannel }),
    };
  }
}

// v18: activity attribution passed to emit* when an action originates from a merchant OAuth request.
export interface EventActivityAttribution {
  clientId?: string;
  merchantAgreementReference?: string;
  actingPartyReference?: string;
  actingChannel?: 'session' | 'oauth_merchant';
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
  attribution?: EventActivityAttribution;
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
  attribution?: EventActivityAttribution;
}

// §9.2 flip: publish-then-project. Business logic publishes the domain event; the LedgerProjection
// bus subscriber writes the businessProcessEvent/complianceProcessEvent ledger. No direct write here
// (the legacy write-then-mirror double-write is gone). Fire-and-forget; never blocks (PCI DSS).
// `_db` is retained for call-site compatibility but unused: the projection owns the DB write.
export function emitProcessEvent(_db: Db, opts: EmitProcessEventOpts): void {
  publishLedgerEvent(opts, 'business');
}

// v18: DRY helper, build the activity attribution from a merchant OAuth context (request.merchantContext).
// Merchant endpoints pass the result as `attribution` to emit* so every OAuth-originated action is tagged
// uniformly (audit). Session (non-OAuth) actions omit it → default 'session' channel downstream.
export function attributionFromMerchantContext(
  ctx?: { clientId?: string; merchantId?: string; sub?: string },
): EventActivityAttribution | undefined {
  if (!ctx?.clientId) return undefined;
  return {
    clientId: ctx.clientId,
    merchantAgreementReference: ctx.merchantId,
    actingPartyReference: ctx.sub,
    actingChannel: 'oauth_merchant',
  };
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
    // Deep "related reference" match across entityId + event summary/payload: used by the auditor to
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
      // and search, so an integration event is findable by its transaction/case id, not only by the
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

// ── v18 B-01/B-12: Merchant activity view ────────────────────────────────────
// "Which user did what action through which merchant/app." Reads businessProcessEvent
// filtered by merchantAgreementReference (the OAuth-originated actions tagged in A-08/A-10),
// with optional actingPartyReference (user) filter, free-text search and date range.
// Display-safe: businessProcessEvent never carries CHD (stripped by the bus, PCI DSS) and
// no raw IBAN; we project a bounded, non-sensitive shape for the auditor view.
export interface MerchantActivityRow {
  id: string;
  eventDateTime: Date;
  processType: string;
  processAction: string;
  processOutcome: string;
  entityType: string;
  entityId: string;
  clientId?: string;
  actingPartyReference?: string;
  actingUserName?: string; // display-safe name for the acting party (no CHD, no IBAN)
  actingChannel?: string;
  summary?: Record<string, unknown>;
}

export async function listMerchantActivity(
  db: Db,
  merchantId: string,
  opts: {
    actingPartyReference?: string;
    q?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  },
): Promise<{ events: MerchantActivityRow[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(opts.limit ?? 20, 100);
  const query: Record<string, unknown> = { merchantAgreementReference: merchantId };
  if (opts.actingPartyReference) query.actingPartyReference = opts.actingPartyReference;
  if (opts.q) {
    const rx = { $regex: opts.q, $options: 'i' };
    query.$or = [{ processAction: rx }, { entityId: rx }, { processType: rx }, { actingPartyReference: rx }];
  }
  if (opts.from || opts.to) {
    const dateFilter: Record<string, Date> = {};
    if (opts.from) dateFilter.$gte = opts.from;
    if (opts.to)   dateFilter.$lte = opts.to;
    query.eventDateTime = dateFilter;
  }

  const col = db.collection<BusinessProcessEvent>(BUSINESS_PROCESS_EVENTS_COLLECTION);
  const [docs, total] = await Promise.all([
    col.find(query).sort({ eventDateTime: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(query),
  ]);
  // Resolve display-safe acting-user names in one batch: name only, no CHD, no IBAN.
  const subs = [...new Set(docs.map((d) => d.actingPartyReference).filter((s): s is string => !!s))];
  const users = subs.length
    ? await db.collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
        .find({ customerAuthenticationInstanceReference: { $in: subs } })
        .toArray()
    : [];
  const nameBySub = new Map(users.map((u) => [u.customerAuthenticationInstanceReference, u.customerAuthenticationUserName]));

  const events: MerchantActivityRow[] = docs.map((d) => ({
    id: d.businessProcessEventInstanceReference,
    eventDateTime: d.eventDateTime,
    processType: d.processType,
    processAction: d.processAction,
    processOutcome: d.processOutcome,
    entityType: d.entityType,
    entityId: d.entityId,
    clientId: d.clientId,
    actingPartyReference: d.actingPartyReference,
    actingUserName: d.actingPartyReference ? nameBySub.get(d.actingPartyReference) : undefined,
    actingChannel: d.actingChannel,
    summary: d.eventSummary,
  }));
  return { events, total, page, limit };
}

// v18 D-02: operations the CALLING USER executed through a given app (self-scoped connected-apps view).
// Filters businessProcessEvent by actingPartyReference === sub AND (clientId === app OR
// merchantAgreementReference === app's merchant). Reuses MerchantActivityRow (same display-safe shape:
// no CHD: stripped by the bus, PCI DSS, and no raw IBAN). Free-text search + date range + paging.
export async function listPartyAppActivity(
  db: Db,
  opts: {
    actingPartyReference: string;
    clientId?: string;
    merchantAgreementReference?: string;
    q?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  },
): Promise<{ events: MerchantActivityRow[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(opts.limit ?? 20, 100);

  // Self-scope: only the caller's own attributed activity.
  const and: Record<string, unknown>[] = [{ actingPartyReference: opts.actingPartyReference }];
  // App-scope: match either the OAuth client id or the merchant reference (whichever the events carry).
  const appOr: Record<string, unknown>[] = [];
  if (opts.clientId) appOr.push({ clientId: opts.clientId });
  if (opts.merchantAgreementReference) appOr.push({ merchantAgreementReference: opts.merchantAgreementReference });
  if (appOr.length) and.push({ $or: appOr });
  if (opts.q) {
    const rx = { $regex: opts.q, $options: 'i' };
    and.push({ $or: [{ processAction: rx }, { entityId: rx }, { processType: rx }] });
  }
  if (opts.from || opts.to) {
    const dateFilter: Record<string, Date> = {};
    if (opts.from) dateFilter.$gte = opts.from;
    if (opts.to)   dateFilter.$lte = opts.to;
    and.push({ eventDateTime: dateFilter });
  }
  const query = { $and: and };

  const col = db.collection<BusinessProcessEvent>(BUSINESS_PROCESS_EVENTS_COLLECTION);
  const [docs, total] = await Promise.all([
    col.find(query).sort({ eventDateTime: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(query),
  ]);
  const events: MerchantActivityRow[] = docs.map((d) => ({
    id: d.businessProcessEventInstanceReference,
    eventDateTime: d.eventDateTime,
    processType: d.processType,
    processAction: d.processAction,
    processOutcome: d.processOutcome,
    entityType: d.entityType,
    entityId: d.entityId,
    clientId: d.clientId,
    actingPartyReference: d.actingPartyReference,
    actingChannel: d.actingChannel,
    summary: d.eventSummary,
  }));
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

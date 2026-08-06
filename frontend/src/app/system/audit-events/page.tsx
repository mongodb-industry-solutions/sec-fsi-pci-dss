'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Activity, RefreshCw, Search, ChevronDown, ChevronRight, ExternalLink, Download } from 'lucide-react';
import { SectionHeader } from '../../../components/SectionHeader';
import { Pagination } from '../../../components/Pagination';
import { api } from '../../../lib/api';
import { getToken } from '../../../lib/auth';
import { useEffectivePermissions } from '../../../lib/permissions';
import { JsonView } from '../../../components/json/JsonView';
import { DateTimeRangeFilter } from '../../../components/search/DateTimeRangeFilter';
import { Combobox, type ComboOption } from '../../../components/ui/Combobox';
import { downloadJsonFile, appliedFilters } from '../../../lib/downloadJson';

import { serviceDomainLabel } from '../../../lib/serviceDomain';
type AuditRow = {
  id: string;
  source: string;
  eventDateTime: string;
  type: string;
  action: string;
  outcome: string;
  entityType?: string;
  entityId?: string;
  performedByRole?: string | null;
  bianServiceDomain?: string;
  context?: string;
  summary?: Record<string, unknown>;
};

const SOURCES = [
  { value: 'all', label: 'All' },
  { value: 'business', label: 'Business' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'integration', label: 'Integration tests' },
];

const OUTCOME_STYLES: Record<string, string> = {
  approved: 'bg-green-100 text-green-700', received: 'bg-green-100 text-green-700', sent: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700', failed: 'bg-red-100 text-red-700', error: 'bg-red-100 text-red-700', timeout: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700', escalated: 'bg-purple-100 text-purple-700',
};
// Known event types per source: business/compliance processType unions and the integration
// event kinds. The field stays free text, since a custom provider can emit its own type.
const EVENT_TYPES: Record<string, string[]> = {
  business: [
    'payment_processing', 'fraud_evaluation', 'aml_screening', 'card_authorization',
    'credit_assessment', 'sanctions_check', 'consent_management', 'checkout',
  ],
  compliance: [
    'kyc_verification', 'kyb_verification', 'customer_onboarding', 'merchant_onboarding',
    'card_management', 'payment_processing', 'authentication',
  ],
  integration: ['dispatch', 'callback', 'health_check', 'test'],
};

// The row's `outcome` merges two fields: processOutcome on business/compliance events (a verdict
// plus the SD-65 payout lifecycle states) and integrationEventStatus on integration events (call
// delivery). Grouping them says which vocabulary belongs to which stream.
const OUTCOME_GROUPS: Array<{ label: string; values: string[] }> = [
  { label: 'Verdict', values: ['approved', 'rejected', 'escalated', 'verified'] },
  { label: 'In progress', values: ['pending', 'submitted', 'in_flight', 'settled'] },
  { label: 'Failure', values: ['failed', 'error', 'timeout'] },
  { label: 'Integration delivery', values: ['sent', 'received'] },
];

const OUTCOME_OPTIONS: ComboOption[] = [
  { value : '', label: 'All' },
  ...OUTCOME_GROUPS.flatMap((g) => g.values.map((v) => ({ value: v, label: v.replace(/_/g, ' '), group: g.label }))),
];

const ENTITY_OPTIONS: ComboOption[] = [
  { value : '', label: 'All entities' },
  { value: 'fraud_case', label: 'Investigation case' },
  { value: 'transaction', label: 'Transaction' },
  { value: 'customer', label: 'Customer (KYC)' },
  { value: 'merchant', label: 'Merchant (KYB)' },
  { value: 'integration', label: 'Integration' },
];

const SOURCE_STYLES: Record<string, string> = {
  business: 'bg-blue-50 text-blue-700 border-blue-200',
  compliance: 'bg-teal-50 text-teal-700 border-teal-200',
  integration: 'bg-violet-50 text-violet-700 border-violet-200',
};

// Deep-link an audit event to the business entity it relates to. Customer (KYC) has no
// dedicated by-id route, so it is shown without a link.
function entityHref(entityType?: string, entityId?: string | null): string | null {
  if (!entityId) return null;
  switch (entityType) {
    case 'fraud_case':    return `/system/investigation/${entityId}`;
    case 'transaction':   return `/system/transactions/${entityId}`;
    case 'p2p_transfer':  return `/system/payment/history`;
    case 'merchant':      return `/system/merchant/${entityId}`;
    case 'integration':   return `/system/admin/providers/vendors/${entityId}`;
    default:              return null;
  }
}
const ENTITY_LABEL: Record<string, string> = {
  fraud_case: 'case', transaction: 'transaction', p2p_transfer: 'P2P transfer',
  merchant: 'merchant', customer: 'customer', integration: 'integration',
};

// Filters live in the query string, so a prefiltered link (e.g. from a transaction detail page)
// opens the trail already scoped, and any view an operator reaches is shareable and bookmarkable.
function AuditEventsView() {
  const router = useRouter();
  const params = useSearchParams();
  const param = (key: string, fallback = '') => params.get(key) ?? fallback;
  const { loading: permsLoading, can } = useEffectivePermissions();
  const [token, setToken] = useState('');
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  const [events, setEvents] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [source, setSource] = useState(() => param('source', 'all'));
  const [typeInput, setTypeInput] = useState(() => param('type'));
  const [entityType, setEntityType] = useState(() => param('entityType'));
  const [outcome, setOutcome] = useState(() => param('outcome'));
  const [q, setQ] = useState(() => param('q'));
  const [ref, setRef] = useState(() => param('ref'));
  const [minScore, setMinScore] = useState(() => param('minScore'));
  const [from, setFrom] = useState(() => param('from'));
  const [to, setTo] = useState(() => param('to'));
  const [page, setPage] = useState(() => Math.max(1, parseInt(param('page', '1'), 10) || 1));
  const [pageSize, setPageSize] = useState(() => Math.max(1, parseInt(param('limit', '10'), 10) || 10));

  useEffect(() => { setToken(getToken() ?? ''); }, []);

  // Data-driven RBAC (ADR-030): authorize on the effective auditEvents:view permission rather than a
  // hard-coded role list, so role edits / custom roles are honored. Wait for permissions to load to
  // avoid a default-deny redirect flash.
  useEffect(() => {
    if (permsLoading) return;
    if (!can('auditEvents', 'view')) { setAuthorized(false); router.replace('/system'); return; }
    setAuthorized(true);
  }, [permsLoading, can, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api.processEvents.audit(token, {
        source, type: typeInput || undefined, entityType: entityType || undefined,
        outcome: outcome || undefined, q: q || undefined, ref: ref || undefined,
        minScore: minScore ? parseInt(minScore, 10) : undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        page, limit: pageSize,
      });
      setEvents(res.events as AuditRow[]);
      setTotal(res.total);
      setCapped(res.capped);
    } catch { setEvents([]); setTotal(0); }
    finally { setLoading(false); }
  }, [token, source, typeInput, entityType, outcome, q, ref, minScore, from, to, page, pageSize]);

  useEffect(() => { if (authorized) load(); }, [authorized, load]);

  // Mirror the active filters into the URL (replace, so filtering does not pile up history
  // entries). Only non-default values are written, keeping shared links short.
  const lastQuery = useRef<string | null>(null);
  useEffect(() => {
    if (!authorized) return;
    const next = new URLSearchParams();
    if (source !== 'all') next.set('source', source);
    if (typeInput) next.set('type', typeInput);
    if (entityType) next.set('entityType', entityType);
    if (outcome) next.set('outcome', outcome);
    if (q) next.set('q', q);
    if (ref) next.set('ref', ref);
    if (minScore) next.set('minScore', minScore);
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    if (page > 1) next.set('page', String(page));
    if (pageSize !== 10) next.set('limit', String(pageSize));
    const qs = next.toString();
    if (lastQuery.current === qs) return;
    lastQuery.current = qs;
    router.replace(qs ? `/system/audit-events?${qs}` : '/system/audit-events', { scroll: false });
  }, [authorized, router, source, typeInput, entityType, outcome, q, ref, minScore, from, to, page, pageSize]);

  // Export the events matching the CURRENTLY APPLIED filters as a JSON file, so a reviewer can work
  // from a bounded, scoped extract instead of the whole stream. Walks the paginated API (100/page,
  // capped at 5000) and writes each event with its category (source) and all observable fields.
  const downloadJson = useCallback(async () => {
    if (!token) return;
    setDownloading(true);
    try {
      const filters = {
        source, type: typeInput || undefined, entityType: entityType || undefined,
        outcome: outcome || undefined, q: q || undefined, ref: ref || undefined,
        minScore: minScore ? parseInt(minScore, 10) : undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
      };
      const MAX = 5000, PER = 100;
      const collected: AuditRow[] = [];
      let pageN = 1;
      let grandTotal = 0;
      for (;;) {
        const res = await api.processEvents.audit(token, { ...filters, page: pageN, limit: PER });
        grandTotal = res.total;
        collected.push(...(res.events as AuditRow[]));
        if (collected.length >= res.total || res.events.length < PER || collected.length >= MAX) break;
        pageN += 1;
      }
      const payload = {
        generatedAt: new Date().toISOString(),
        filtersApplied: appliedFilters(filters),
        totalMatching: grandTotal,
        exported: collected.length,
        truncated: collected.length < grandTotal,
        events: collected.map((e) => ({
          event: e.action,
          category: e.source,
          type: e.type,
          outcome: e.outcome,
          eventDateTime: e.eventDateTime,
          entityType: e.entityType ?? null,
          entityId: e.entityId ?? null,
          performedByRole: e.performedByRole ?? null,
          bianServiceDomain: e.bianServiceDomain ?? null,
          context: e.context ?? null,
          summary: e.summary ?? null,
          id: e.id,
        })),
      };
      downloadJsonFile('audit-events', payload);
    } catch { /* surfaced via the empty download; non-blocking */ }
    finally { setDownloading(false); }
  }, [token, source, typeInput, entityType, outcome, q, ref, minScore, from, to]);

  // Suggestions follow the selected source, plus any type present in the loaded page so a
  // provider-specific value is one click away once it has been seen.
  const typeOptions = Array.from(new Set([
    ...(source === 'all' ? Object.values(EVENT_TYPES).flat() : EVENT_TYPES[source] ?? []),
    ...events.map((e) => e.type).filter(Boolean),
  ])).sort();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  function resetToFirst() { setPage(1); }

  if (authorized === false) return null;

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-5">
      <SectionHeader
        icon={Activity}
        title="Audit Events"
        description="Unified, searchable audit trail across the whole platform."
        info="Combines business process events, compliance events, and integration (inbound/outbound test) events into one stream. Filter by source, event type, outcome, date range, or free text."
        debugInfo="ADR-025 · businessProcessEvent + complianceProcessEvent + integrationEvents · PCI DSS Req 10.2 / 10.3 / 10.7"
        actions={
          <button onClick={downloadJson} disabled={downloading || loading}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium disabled:opacity-50"
            title="Download the events matching the current filters as JSON">
            <Download size={14} />{downloading ? 'Preparing…' : 'Download JSON'}
          </button>
        }
      />

      {/* Source segmented control */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {SOURCES.map((s) => (
          <button key={s.value}
            onClick={() => { setSource(s.value); resetToFirst(); }}
            className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${source === s.value ? 'bg-white shadow text-[#001E2B]' : 'text-gray-500 hover:text-gray-700'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="lg:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Search</label>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => { setQ(e.target.value); resetToFirst(); }}
              placeholder="Action, type or entity id…"
              className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
        </div>
        <div className="lg:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Related reference (txn · case · merchant · customer · card token · login flow id)</label>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={ref} onChange={(e) => { setRef(e.target.value); resetToFirst(); }}
              placeholder="Paste a transaction id, case id, merchant id, account ref, card token or login flow id (flow:…)…"
              className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Event type</label>
          <Combobox
            value={typeInput}
            onChange={(v) => { setTypeInput(v); resetToFirst(); }}
            options={typeOptions.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))}
            placeholder="Choose or type…"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Outcome / status</label>
          <Combobox
            editable={false}
            value={outcome}
            onChange={(v) => { setOutcome(v); resetToFirst(); }}
            placeholder="All"
            options={OUTCOME_OPTIONS}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Related entity</label>
          <Combobox
            editable={false}
            value={entityType}
            onChange={(v) => { setEntityType(v); resetToFirst(); }}
            placeholder="All entities"
            options={ENTITY_OPTIONS}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Min risk score (SDF)</label>
          <input type="number" min={0} max={100} value={minScore}
            onChange={(e) => { setMinScore(e.target.value); resetToFirst(); }}
            placeholder="e.g. 70"
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <DateTimeRangeFilter
            value={{ from, to }}
            onChange={(next) => { setFrom(next.from); setTo(next.to); resetToFirst(); }}
          />
        </div>
        <div className="flex items-end gap-2">
          {(q || ref || typeInput || entityType || outcome || minScore || from || to) && (
            <button onClick={() => { setQ(''); setRef(''); setTypeInput(''); setEntityType(''); setOutcome(''); setMinScore(''); setFrom(''); setTo(''); resetToFirst(); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Clear</button>
          )}
          <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors inline-flex items-center gap-1">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Arriving from a record's "View audit trail" link: say what the stream is scoped to. */}
      {ref && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <span>Scoped to events referencing</span>
          <code className="font-mono bg-white/70 border border-blue-200 rounded px-1.5 py-0.5">{ref}</code>
          <button onClick={() => { setRef(''); resetToFirst(); }}
            className="ml-auto rounded border border-blue-300 px-2 py-0.5 hover:bg-white/70">
            Remove this filter
          </button>
        </div>
      )}

      {capped && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Showing a bounded window of the most recent events per source. Narrow the date range or filters to see older events.
        </p>
      )}

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading…</div>
        ) : events.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No events match the current filters.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {events.map((ev) => {
              const open = expanded === ev.id;
              const href = entityHref(ev.entityType, ev.entityId);
              const score = (ev.summary as { score?: unknown } | undefined)?.score;
              return (
                <li key={ev.id} className="px-5 py-3">
                  <div className="flex items-start gap-2">
                    <button onClick={() => setExpanded(open ? null : ev.id)} className="flex-1 min-w-0 flex items-start gap-3 text-left">
                      {open ? <ChevronDown size={14} className="mt-1 text-gray-400 shrink-0" /> : <ChevronRight size={14} className="mt-1 text-gray-400 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[11px] px-1.5 py-0.5 rounded-full border font-medium ${SOURCE_STYLES[ev.source] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>{ev.source}</span>
                          <span className="font-mono text-xs text-[#001E2B] font-semibold break-all">{ev.action}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OUTCOME_STYLES[ev.outcome] ?? 'bg-gray-100 text-gray-600'}`}>{ev.outcome}</span>
                          <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{ev.type}</span>
                          {ev.context && <span className="text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">{ev.context}</span>}
                          {typeof score === 'number' && <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-medium">risk {score}</span>}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {ev.entityType && <span className="font-medium">{ENTITY_LABEL[ev.entityType] ?? ev.entityType}</span>}
                          {ev.entityId && <> · <span className="font-mono">{ev.entityId.slice(0, 16)}…</span></>}
                          {ev.performedByRole && <> · <span>{ev.performedByRole}</span></>}
                          {ev.bianServiceDomain && <> · <span className="text-gray-400">{serviceDomainLabel(ev.bianServiceDomain)}</span></>}
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 shrink-0 tabular-nums">{new Date(ev.eventDateTime).toLocaleString()}</div>
                    </button>
                    {href && (
                      <Link href={href} title={`Open related ${ENTITY_LABEL[ev.entityType ?? ''] ?? 'entity'}`}
                        className="shrink-0 inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline mt-0.5">
                        Open <ExternalLink size={12} />
                      </Link>
                    )}
                  </div>
                  {open && ev.summary && (
                    <div className="mt-2 ml-7">
                      <JsonView data={ev.summary} maxHeight="15rem" />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!loading && events.length > 0 && (
          <div className="px-3 py-2 border-t border-gray-100">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              limit={pageSize}
              onPageChange={setPage}
              onLimitChange={(l) => { setPageSize(l); setPage(1); }}
              limitOptions={[5, 10, 20, 50]}
              noun="events"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuditEventsPage() {
  return (
    <Suspense fallback={<div className="px-5 py-8 text-sm text-gray-400">Loading audit events…</div>}>
      <AuditEventsView />
    </Suspense>
  );
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { Pagination } from '../../../../components/Pagination';
import { api } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';

import { serviceDomainLabel } from '../../../../lib/serviceDomain';
type ProcessEvent = {
  businessProcessEventInstanceReference: string;
  eventDateTime: string;
  processType: string;
  processAction: string;
  processOutcome: string;
  entityType: string;
  entityId: string;
  performedByPartyReference: string | null;
  performedByRole: string | null;
  bianServiceDomain: string;
  eventSummary: Record<string, unknown>;
};

const OUTCOME_STYLES: Record<string, string> = {
  approved:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
  pending:   'bg-yellow-100 text-yellow-700',
  failed:    'bg-red-100 text-red-700',
  escalated: 'bg-purple-100 text-purple-700',
};

const TAB_PROCESS_TYPES = [
  { value : '', label: 'All' },
  { value: 'payment_processing', label: 'Payment' },
  { value: 'fraud_evaluation', label: 'Fraud' },
  { value: 'aml_screening', label: 'AML' },
  { value: 'card_authorization', label: 'Card Auth' },
  { value: 'sanctions_check', label: 'Sanctions' },
  { value: 'kyc_verification', label: 'KYC' },
  { value: 'kyb_verification', label: 'KYB' },
  { value: 'merchant_onboarding', label: 'Merchant' },
];

export default function AdminEventsPage() {
  const [tab, setTab] = useState<'process' | 'compliance'>('process');
  const [processType, setProcessType] = useState('');
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const token = getToken() ?? '';
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: pageSize };
      if (processType) params.processType = processType;
      if (tab === 'process') {
        const res = await api.processEvents.list(token, params as never);
        setEvents(res.events as unknown as ProcessEvent[]);
        setTotal(res.total);
      } else {
        const res = await api.processEvents.listCompliance(token, params as never);
        setEvents(res.events as unknown as ProcessEvent[]);
        setTotal(res.total);
      }
    } catch { setEvents([]); setTotal(0); }
    setLoading(false);
  }, [tab, processType, page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-5 max-w-5xl">
      <SectionHeader
        icon={Activity}
        title="Business Process Events"
        description="Unified audit trail across all business processes."
        debugInfo="ADR-025 · businessProcessEvent + complianceProcessEvent (timeseries) · PCI DSS Req 10.2.1 / 10.3 / 10.7"
      />

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(['process', 'compliance'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-white shadow text-[#001E2B]' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {t === 'process' ? 'Process Events' : 'Compliance Events'}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex flex-wrap gap-1">
          {TAB_PROCESS_TYPES
            .filter(pt => {
              if (tab === 'compliance') return ['', 'kyc_verification', 'kyb_verification', 'merchant_onboarding', 'customer_onboarding'].includes(pt.value);
              return true;
            })
            .map(pt => (
              <button
                key={pt.value}
                onClick={() => { setProcessType(pt.value); setPage(1); }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${processType === pt.value ? 'bg-[#001E2B] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {pt.label}
              </button>
            ))}
        </div>
        <button onClick={load} className="ml-auto text-xs text-[#001E2B] font-medium hover:underline flex items-center gap-1">
          <RefreshCw size={12} />Refresh
        </button>
      </div>

      {/* Events list */}
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading…</div>
        ) : events.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No events found. Events appear after business processes execute.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {events.map(ev => (
              <li key={ev.businessProcessEventInstanceReference} className="px-5 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-[#001E2B] font-semibold">{ev.processAction}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OUTCOME_STYLES[ev.processOutcome] ?? 'bg-gray-100 text-gray-600'}`}>{ev.processOutcome}</span>
                      <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{ev.processType}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      <span className="font-medium">{ev.entityType}</span>
                      {' · '}
                      <span className="font-mono">{ev.entityId.slice(0, 12)}…</span>
                      {ev.performedByRole && <> · <span>{ev.performedByRole}</span></>}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{serviceDomainLabel(ev.bianServiceDomain)}</div>
                  </div>
                  <div className="text-xs text-gray-400 shrink-0 tabular-nums">
                    {new Date(ev.eventDateTime).toLocaleString()}
                  </div>
                </div>
              </li>
            ))}
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
              limitOptions={[10, 20, 50]}
              noun="events"
            />
          </div>
        )}
      </div>
    </div>
  );
}

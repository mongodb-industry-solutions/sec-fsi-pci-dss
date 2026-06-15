'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Receipt, TrendingUp, CreditCard, CalendarDays, ShieldCheck, Building2, ClipboardCheck, Search, ExternalLink, BriefcaseMedical } from 'lucide-react';
import { api } from '../../../../lib/api';
import { decodeToken } from '../../../../lib/auth';
import { useMerchant } from '../../../../lib/merchantContext';
import { StatCard, MonthlyBars, BreakdownBars } from '../../../../components/dashboard/Stats';
import { Pagination } from '../../../../components/Pagination';
import { Breadcrumb, type Crumb } from '../../../../components/Breadcrumb';

type Stats = Awaited<ReturnType<typeof api.merchants.stats>>;
type Sale = {
  cardTransactionInstanceReference: string;
  cardTransactionAmount: { amount: number; currency: string };
  cardTransactionDateTime: string;
  cardTransactionStatus: string;
  cardTransactionMaskedPanDisplay: string;
  cardTransactionDescription?: string;
};

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700', agreed: 'bg-emerald-100 text-emerald-700',
  under_review: 'bg-amber-100 text-amber-700', initiated: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-700', suspended: 'bg-orange-100 text-orange-700', closed: 'bg-gray-100 text-gray-600',
};
const SALE_STATUS = (s: string) =>
  s === 'authorized' || s === 'settled' ? 'bg-green-500' : s === 'disputed' ? 'bg-red-500' : s === 'declined' ? 'bg-gray-400' : 'bg-amber-500';

const EVENT_LABEL: Record<string, string> = {
  'merchant.submitted': 'Application submitted',
  'merchant.approved': 'Approved · KYB verified',
  'merchant.rejected': 'Application rejected',
  'merchant.updated': 'Configuration updated',
};

type AuditRow = { label: string; date?: string; role?: string };

// Fallback for merchants seeded before the event log existed: reconstruct lifecycle
// milestones from the authoritative record fields (clearly labelled as derived).
function recordMilestones(m: Record<string, unknown>, kyb?: Record<string, unknown>): AuditRow[] {
  const rows: AuditRow[] = [];
  if (m.recordCreatedDateTime) rows.push({ label: 'Application submitted', date: String(m.recordCreatedDateTime), role: 'customer' });
  if (kyb?.merchantAgreementKybCheckCompletedDate) {
    rows.push({ label: `KYB ${String(kyb.merchantAgreementKybCheckStatus ?? 'completed')}`, date: String(kyb.merchantAgreementKybCheckCompletedDate), role: 'merchant_officer' });
  }
  if (m.merchantReviewedDateTime) rows.push({ label: 'Reviewed by officer', date: String(m.merchantReviewedDateTime), role: 'merchant_officer' });
  return rows.sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime());
}

function InfoRow({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium text-right">{value ?? '-'}</span>
    </div>
  );
}

export default function StaffMerchantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, role, state } = useMerchant();

  const [merchant, setMerchant] = useState<Record<string, unknown> | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Sale[]>([]);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof api.merchants.events>>['events']>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  // Full payments list (acquiring view) with filter/search/pagination + drill-in.
  const isAuditor = role === 'security_auditor';
  const [payments, setPayments] = useState<Sale[]>([]);
  const [payTotal, setPayTotal] = useState(0);
  const [payPage, setPayPage] = useState(1);
  const [payPageSize, setPayPageSize] = useState(10);
  const [payStatus, setPayStatus] = useState('');
  const [paySearchInput, setPaySearchInput] = useState('');
  const [paySearch, setPaySearch] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  // For the auditor only: which payments already have a linked fraud case (read-only).
  const [caseMap, setCaseMap] = useState<Record<string, { id: string; ref: string; status: string } | null>>({});
  // Breadcrumb context: a merchant opened from a transaction or a case reflects that path.
  const [navCtx, setNavCtx] = useState<{ from: string; txnId?: string; caseId?: string; caseRef?: string } | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const from = sp.get('from');
    if (from === 'transaction' && sp.get('txnId')) setNavCtx({ from, txnId: sp.get('txnId')! });
    else if (from === 'investigation' && sp.get('caseId')) setNavCtx({ from, caseId: sp.get('caseId')!, caseRef: sp.get('caseRef') ?? undefined });
  }, []);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const m = await api.merchants.getById(id, token);
      setMerchant(m);
      // Authorization: staff (officer/auditor) or the merchant's own owner.
      const partyRef = decodeToken(token)?.partyRef;
      // PSP staff + fraud investigators (L1/L2) may view a merchant; investigators reach it from a
      // case (SD-89 referenced by SD-83). The administrative `manager` role is excluded (PCI Req 7).
      const isStaff = role === 'merchant_officer' || role === 'security_auditor'
        || role === 'level1_analyst' || role === 'level2_investigator';
      const isOwner = !!partyRef && (m as Record<string, unknown>).merchantOwnerPartyReference === partyRef;
      if (!isStaff && !isOwner) { setDenied(true); setLoading(false); return; }

      const [s, r, e] = await Promise.all([
        api.merchants.stats(id, token).catch(() => null),
        api.merchants.transactions(id, { limit: 8 }, token).catch(() => ({ results: [] as Sale[] })),
        api.merchants.events(id, token).catch(() => ({ events: [] })),
      ]);
      setStats(s);
      setRecent(r.results as Sale[]);
      setEvents(e.events);
    } catch {
      setMerchant(null);
    }
    setLoading(false);
  }, [id, token, role]);

  useEffect(() => { if (state !== 'loading') load(); }, [state, load]);

  const loadPayments = useCallback(async () => {
    if (!token || !id || denied) return;
    setPayLoading(true);
    try {
      const res = await api.merchants.transactions(
        id, { page: payPage, limit: payPageSize, status: payStatus || undefined, search: paySearch || undefined }, token,
      );
      const list = res.results as Sale[];
      setPayments(list);
      setPayTotal(res.total);
      // Auditor oversight (read-only): surface any existing investigation case per payment.
      // Officer/owner are blocked from /fraud, so the lookup runs for the auditor only.
      if (isAuditor && list.length) {
        const entries = await Promise.all(list.map(async (s) => {
          const cases = await api.fraud.list({ transactionId: s.cardTransactionInstanceReference, limit: 1 }, token).catch(() => null);
          const c = cases?.results?.[0];
          return [s.cardTransactionInstanceReference, c ? { id: c.fraudDiagnosisInstanceReference, ref: c.fraudDiagnosisCaseReference, status: c.caseStatus } : null] as const;
        }));
        setCaseMap(Object.fromEntries(entries));
      } else {
        setCaseMap({});
      }
    } catch { setPayments([]); setPayTotal(0); }
    finally { setPayLoading(false); }
  }, [id, token, denied, payPage, payPageSize, payStatus, paySearch, isAuditor]);

  useEffect(() => { if (merchant && !denied) loadPayments(); }, [merchant, denied, loadPayments]);

  if (loading) return <div className="px-5 sm:px-8 py-8 text-center text-sm text-gray-400">Loading merchant…</div>;
  if (denied) {
    return (
      <div className="px-5 sm:px-8 py-8">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          You don&apos;t have access to this merchant.
        </div>
      </div>
    );
  }
  if (!merchant) return <div className="px-5 sm:px-8 py-8 text-center text-sm text-gray-500">Merchant not found.</div>;

  const m = merchant as Record<string, string | number | string[] | Record<string, unknown> | undefined>;
  const status = String(m.merchantAgreementStatus ?? '');
  const kyb = m.merchantAgreementKybCheck as Record<string, unknown> | undefined;
  const currencies = (m.merchantAllowedCurrencies as string[] | undefined)?.join(', ');
  const topCurrency = stats?.byCurrency[0];
  const now = new Date();
  const thisMonth = stats?.byMonth.find((x) => x.year === now.getFullYear() && x.month === now.getMonth() + 1);
  const fmt = (a: number, c: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(a);
  const isOfficer = role === 'merchant_officer';
  const pending = status === 'under_review' || status === 'initiated';
  const auditDerived = events.length === 0;
  const auditRows: AuditRow[] = auditDerived
    ? recordMilestones(m, kyb)
    : events.map((e) => ({ label: EVENT_LABEL[e.eventType] ?? e.eventType, date: e.eventDateTime, role: e.performedByRole }));

  const mname = String(m.merchantName ?? 'Merchant');
  const crumbs: Crumb[] =
    navCtx?.from === 'investigation' && navCtx.caseId
      ? [
          { label: 'Home', href: '/system' },
          { label: 'Cases', href: '/system/investigation' },
          { label: navCtx.caseRef || 'Case', href: `/system/investigation/${navCtx.caseId}` },
          { label: mname },
        ]
      : navCtx?.from === 'transaction' && navCtx.txnId
      ? [
          { label: 'Home', href: '/system' },
          { label: 'Transactions', href: '/system/transactions' },
          { label: 'Transaction', href: `/system/transactions/${navCtx.txnId}` },
          { label: mname },
        ]
      : [
          { label: 'Home', href: '/system' },
          { label: 'Merchants', href: '/system/merchant' },
          { label: mname },
        ];

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-6">
      <Breadcrumb items={crumbs} />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Building2 size={20} className="text-[#001E2B]" />
            <h1 className="text-xl font-bold text-gray-900">{String(m.merchantName ?? 'Merchant')}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-600'}`}>{status.replace(/_/g, ' ')}</span>
            {m.merchantRiskCategory === 'high' && <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full">high risk</span>}
          </div>
          <p className="text-xs text-gray-400 font-mono mt-1">{String(m.merchantAgreementInstanceReference ?? '')}</p>
        </div>
        {isOfficer && pending && (
          <Link href="/system/merchant/review"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] text-sm font-medium hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors shrink-0">
            <ClipboardCheck size={14} /> Go to review queue
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Merchant info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 text-sm mb-2">Merchant details</h2>
          <div className="divide-y divide-gray-50">
            <InfoRow label="Legal entity" value={String(m.merchantLegalEntityReference ?? '-')} />
            <InfoRow label="MCC" value={String(m.merchantCategoryCode ?? '-')} />
            <InfoRow label="Country" value={String(m.merchantCountryCode ?? '-')} />
            <InfoRow label="Tier" value={String(m.merchantTier ?? '-')} />
            <InfoRow label="Allowed currencies" value={currencies ?? '-'} />
            <InfoRow label="Transaction limit" value={m.merchantTransactionLimitAmount as number | undefined} />
            <InfoRow label="Settlement" value={String(m.merchantSettlementSchedule ?? '-')} />
            <InfoRow label="Risk category" value={String(m.merchantRiskCategory ?? '-')} />
          </div>
        </div>

        {/* KYB (BIAN SD-89 BQ:Step) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 text-sm mb-2 flex items-center gap-1.5"><ShieldCheck size={14} className="text-teal-600" /> KYB check (SD-89)</h2>
          {kyb ? (
            <div className="divide-y divide-gray-50">
              <InfoRow label="Status" value={String(kyb.merchantAgreementKybCheckStatus ?? '-')} />
              <InfoRow label="Reference" value={String(kyb.merchantAgreementKybCheckReference ?? '-')} />
              <InfoRow label="Completed" value={kyb.merchantAgreementKybCheckCompletedDate ? new Date(String(kyb.merchantAgreementKybCheckCompletedDate)).toLocaleDateString() : '-'} />
              {kyb.merchantAgreementKybCheckNotes != null && (
                <div className="py-1.5 text-sm"><span className="text-gray-500">Notes</span><p className="text-gray-700 mt-0.5">{String(kyb.merchantAgreementKybCheckNotes)}</p></div>
              )}
            </div>
          ) : <p className="text-sm text-gray-400">No KYB record.</p>}
        </div>
      </div>

      {/* Acquiring analytics (reuses /:id/stats; officer/auditor authorized; no payer PII) */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Activity <span className="text-xs font-normal text-gray-400">· aggregates only, no payer PII (PCI DSS Req 3/7)</span></h2>
        {!stats ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">No activity available.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={<Receipt size={14} />} label="Operations" value={String(stats.count)} sub="payments received" />
              <StatCard icon={<TrendingUp size={14} />} label="Gross volume" value={topCurrency ? fmt(topCurrency.amount, topCurrency.currency) : '-'} sub={stats.byCurrency.length > 1 ? `+${stats.byCurrency.length - 1} currencies` : undefined} />
              <StatCard icon={<CreditCard size={14} />} label="Avg ticket" value={topCurrency ? fmt(stats.avgAmount, topCurrency.currency) : stats.avgAmount.toFixed(2)} />
              <StatCard icon={<CalendarDays size={14} />} label="This month" value={String(thisMonth?.count ?? 0)} sub="operations" />
            </div>
            <MonthlyBars title="Operations by month" data={stats.byMonth} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <BreakdownBars title="By status" total={stats.count} items={stats.byStatus.map((x) => ({ label: x.status.replace(/_/g, ' '), value: x.count, colorClass: SALE_STATUS(x.status) }))} />
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-800 text-sm mb-3">Recent payments</h2>
                {recent.length === 0 ? <p className="text-sm text-gray-400">No payments yet.</p> : (
                  <ul className="divide-y divide-gray-100">
                    {recent.map((s) => (
                      <li key={s.cardTransactionInstanceReference} className="py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-700 truncate">{s.cardTransactionDescription ?? s.cardTransactionMaskedPanDisplay}</p>
                          <p className="text-xs text-gray-400">{new Date(s.cardTransactionDateTime).toLocaleDateString()} · {s.cardTransactionMaskedPanDisplay}</p>
                        </div>
                        <span className="font-semibold text-gray-900 text-sm whitespace-nowrap">{fmt(s.cardTransactionAmount.amount, s.cardTransactionAmount.currency)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Payments Received; full acquiring list with drill-in (and case oversight for auditor) */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-gray-100 flex-wrap">
          <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5">
            <Receipt size={14} className="text-[#001E2B]" /> Payments Received
            <span className="text-xs font-normal text-gray-400">· masked PAN only, no payer PII (PCI DSS Req 3/7)</span>
          </h2>
          <span className="text-xs text-gray-400">{payTotal} payment{payTotal !== 1 ? 's' : ''}</span>
        </div>

        {isAuditor && (
          <div className="px-5 py-2 border-b border-gray-100 bg-blue-50/60 text-xs text-blue-800 flex items-start gap-2">
            <ShieldCheck size={13} className="mt-0.5 shrink-0 text-blue-600" />
            <span>Auditor oversight is read-only: you can analyze any payment and open its linked investigation case to review it, but initiating a new case is an analyst action (separation of duties, PCI DSS Req 7).</span>
          </div>
        )}

        {/* Filter + search */}
        <div className="flex flex-wrap gap-2 items-center px-5 py-3 border-b border-gray-100 bg-gray-50/60">
          <form onSubmit={(e) => { e.preventDefault(); setPayPage(1); setPaySearch(paySearchInput.trim()); }} className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={paySearchInput} onChange={(e) => setPaySearchInput(e.target.value)}
              placeholder="Search masked PAN or descriptor…"
              className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#00ED64]/40" />
          </form>
          <select value={payStatus} onChange={(e) => { setPayStatus(e.target.value); setPayPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">All statuses</option>
            {['authorized', 'settled', 'pending', 'declined', 'disputed'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {payLoading ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading payments…</div>
        ) : payments.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No payments match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Date</th>
                  <th className="text-left font-medium px-4 py-2">Card</th>
                  <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">Description</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                  <th className="text-right font-medium px-4 py-2">Amount</th>
                  <th className="text-right font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map((s) => {
                  const linked = isAuditor ? caseMap[s.cardTransactionInstanceReference] : undefined;
                  return (
                    <tr key={s.cardTransactionInstanceReference} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{new Date(s.cardTransactionDateTime).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{s.cardTransactionMaskedPanDisplay}</td>
                      <td className="px-4 py-2.5 text-gray-600 hidden sm:table-cell truncate max-w-[220px]">{s.cardTransactionDescription ?? '-'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block w-2 h-2 rounded-full mr-1.5 align-middle ${SALE_STATUS(s.cardTransactionStatus)}`} />
                        <span className="capitalize text-xs text-gray-600">{s.cardTransactionStatus}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{fmt(s.cardTransactionAmount.amount, s.cardTransactionAmount.currency)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                          {isAuditor && linked && (
                            <Link href={`/system/investigation/${linked.id}`} title={`${linked.ref} · ${linked.status.replace(/_/g, ' ')}`}
                              className="inline-flex items-center gap-1 text-xs text-orange-600 font-medium hover:underline">
                              <BriefcaseMedical size={12} /> View case
                            </Link>
                          )}
                          <Link href={`/system/transactions/${s.cardTransactionInstanceReference}`}
                            className="inline-flex items-center gap-1 text-xs text-[#001E2B] font-medium hover:underline">
                            Analyze <ExternalLink size={12} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!payLoading && payments.length > 0 && (
          <div className="px-3 py-2 border-t border-gray-100">
            <Pagination
              page={payPage}
              totalPages={Math.max(1, Math.ceil(payTotal / payPageSize))}
              total={payTotal}
              limit={payPageSize}
              onPageChange={setPayPage}
              onLimitChange={(l) => { setPayPageSize(l); setPayPage(1); }}
              limitOptions={[5, 10, 20, 50]}
              noun="payments"
            />
          </div>
        )}
      </div>

      {/* Audit trail (BIAN SD-89 lifecycle · PCI DSS Req 10) */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-1.5"><ClipboardCheck size={14} className="text-[#001E2B]" /> Audit trail</h2>
          <span className="text-[10px] font-mono text-gray-400">SD-89 · Req 10{auditDerived ? ' · derived from record' : ' · append-only log'}</span>
        </div>
        {auditRows.length === 0 ? (
          <p className="text-sm text-gray-400">No lifecycle events recorded.</p>
        ) : (
          <ol className="relative border-l border-gray-200 ml-2 space-y-4">
            {auditRows.map((row, i) => (
              <li key={i} className="ml-4">
                <span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-[#00ED64] border border-white" />
                <p className="text-sm font-medium text-gray-800">{row.label}</p>
                <p className="text-xs text-gray-400">
                  {row.date ? new Date(row.date).toLocaleString() : '-'}{row.role ? ` · ${row.role.replace(/_/g, ' ')}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
        {auditDerived && auditRows.length > 0 && (
          <p className="mt-3 text-xs text-amber-600">Reconstructed from the merchant record (created before the append-only event log). New actions are logged as immutable events.</p>
        )}
      </div>
    </div>
  );
}

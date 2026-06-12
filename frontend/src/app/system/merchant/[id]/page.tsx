'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Receipt, TrendingUp, CreditCard, CalendarDays, ShieldCheck, Building2, ArrowLeft, ClipboardCheck } from 'lucide-react';
import { api } from '../../../../lib/api';
import { decodeToken } from '../../../../lib/auth';
import { useMerchant } from '../../../../lib/merchantContext';
import { StatCard, MonthlyBars, BreakdownBars } from '../../../../components/dashboard/Stats';

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

function InfoRow({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium text-right">{value ?? '—'}</span>
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
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    try {
      const m = await api.merchants.getById(id, token);
      setMerchant(m);
      // Authorization: staff (officer/auditor) or the merchant's own owner.
      const partyRef = decodeToken(token)?.partyRef;
      const isStaff = role === 'merchant_officer' || role === 'security_auditor';
      const isOwner = !!partyRef && (m as Record<string, unknown>).merchantOwnerPartyReference === partyRef;
      if (!isStaff && !isOwner) { setDenied(true); setLoading(false); return; }

      const [s, r] = await Promise.all([
        api.merchants.stats(id, token).catch(() => null),
        api.merchants.transactions(id, { limit: 8 }, token).catch(() => ({ results: [] as Sale[] })),
      ]);
      setStats(s);
      setRecent(r.results as Sale[]);
    } catch {
      setMerchant(null);
    }
    setLoading(false);
  }, [id, token, role]);

  useEffect(() => { if (state !== 'loading') load(); }, [state, load]);

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

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-6">
      <Link href="/system/merchant" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
        <ArrowLeft size={14} /> Back to merchants
      </Link>

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
            <InfoRow label="Legal entity" value={String(m.merchantLegalEntityReference ?? '—')} />
            <InfoRow label="MCC" value={String(m.merchantCategoryCode ?? '—')} />
            <InfoRow label="Country" value={String(m.merchantCountryCode ?? '—')} />
            <InfoRow label="Tier" value={String(m.merchantTier ?? '—')} />
            <InfoRow label="Allowed currencies" value={currencies ?? '—'} />
            <InfoRow label="Transaction limit" value={m.merchantTransactionLimitAmount as number | undefined} />
            <InfoRow label="Settlement" value={String(m.merchantSettlementSchedule ?? '—')} />
            <InfoRow label="Risk category" value={String(m.merchantRiskCategory ?? '—')} />
          </div>
        </div>

        {/* KYB (BIAN SD-89 BQ:Step) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 text-sm mb-2 flex items-center gap-1.5"><ShieldCheck size={14} className="text-teal-600" /> KYB check (SD-89)</h2>
          {kyb ? (
            <div className="divide-y divide-gray-50">
              <InfoRow label="Status" value={String(kyb.merchantAgreementKybCheckStatus ?? '—')} />
              <InfoRow label="Reference" value={String(kyb.merchantAgreementKybCheckReference ?? '—')} />
              <InfoRow label="Completed" value={kyb.merchantAgreementKybCheckCompletedDate ? new Date(String(kyb.merchantAgreementKybCheckCompletedDate)).toLocaleDateString() : '—'} />
              {kyb.merchantAgreementKybCheckNotes != null && (
                <div className="py-1.5 text-sm"><span className="text-gray-500">Notes</span><p className="text-gray-700 mt-0.5">{String(kyb.merchantAgreementKybCheckNotes)}</p></div>
              )}
            </div>
          ) : <p className="text-sm text-gray-400">No KYB record.</p>}
        </div>
      </div>

      {/* Acquiring analytics (reuses /:id/stats — officer/auditor authorized; no payer PII) */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Activity <span className="text-xs font-normal text-gray-400">· aggregates only, no payer PII (PCI DSS Req 3/7)</span></h2>
        {!stats ? (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">No activity available.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={<Receipt size={14} />} label="Operations" value={String(stats.count)} sub="payments received" />
              <StatCard icon={<TrendingUp size={14} />} label="Gross volume" value={topCurrency ? fmt(topCurrency.amount, topCurrency.currency) : '—'} sub={stats.byCurrency.length > 1 ? `+${stats.byCurrency.length - 1} currencies` : undefined} />
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
    </div>
  );
}

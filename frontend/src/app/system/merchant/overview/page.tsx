'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Receipt, TrendingUp, CreditCard, CalendarDays, ArrowRight, ShoppingCart, Link2, LayoutDashboard } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { useRequireActiveMerchant } from '../../../../lib/merchantContext';
import { api } from '../../../../lib/api';

type Stats = {
  count: number; totalAmount: number; avgAmount: number;
  byStatus: Array<{ status: string; count: number; amount: number }>;
  byMonth: Array<{ year: number; month: number; count: number; amount: number }>;
  byCurrency: Array<{ currency: string; count: number; amount: number }>;
};
type Sale = {
  cardTransactionInstanceReference: string;
  cardTransactionAmount: { amount: number; currency: string };
  cardTransactionDateTime: string;
  cardTransactionStatus: string;
  cardTransactionMaskedPanDisplay: string;
  cardTransactionDescription?: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function statusClass(s: string) {
  if (s === 'authorized' || s === 'settled') return 'bg-green-500';
  if (s === 'disputed') return 'bg-red-500';
  if (s === 'declined') return 'bg-gray-400';
  return 'bg-amber-500';
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 text-gray-400">{icon}<span className="text-xs uppercase tracking-wide">{label}</span></div>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function OverviewSectionPage() {
  const { token, merchant } = useRequireActiveMerchant();
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        api.merchants.stats(merchantId, token),
        api.merchants.transactions(merchantId, { limit: 5 }, token),
      ]);
      setStats(s);
      setRecent(r.results);
    } catch { setStats(null); setRecent([]); }
    setLoading(false);
  }, [merchantId, token]);

  useEffect(() => { if (merchantId) load(); }, [merchantId, load]);

  if (!merchant) return null;

  const now = new Date();
  const thisMonth = stats?.byMonth.find((m) => m.year === now.getFullYear() && m.month === now.getMonth() + 1);
  const topCurrency = stats?.byCurrency[0];
  const maxMonth = Math.max(1, ...(stats?.byMonth.map((m) => m.count) ?? [1]));
  const fmt = (amount: number, currency: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

  return (
    <div className="w-full px-5 sm:px-8 py-6 space-y-6">
      <SectionHeader
        icon={LayoutDashboard}
        title="Overview"
        description={`Acquiring activity for ${merchant.merchantName}.`}
        debugInfo="BIAN Merchant Activity Analysis (SD-89) · PCI DSS Req 3 & 7 (aggregates only, no payer PII)"
      />

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading analytics…</div>
      ) : !stats ? (
        <div className="text-center py-12 text-gray-400 text-sm">No analytics available.</div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={<Receipt size={14} />} label="Operations" value={String(stats.count)} sub="payments received" />
            <StatCard icon={<TrendingUp size={14} />} label="Gross volume"
              value={topCurrency ? fmt(topCurrency.amount, topCurrency.currency) : '—'}
              sub={stats.byCurrency.length > 1 ? `+${stats.byCurrency.length - 1} other currencies` : (topCurrency ? `${topCurrency.currency}` : undefined)} />
            <StatCard icon={<CreditCard size={14} />} label="Avg ticket"
              value={topCurrency ? fmt(stats.avgAmount, topCurrency.currency) : stats.avgAmount.toFixed(2)} sub="across all currencies" />
            <StatCard icon={<CalendarDays size={14} />} label="This month" value={String(thisMonth?.count ?? 0)} sub={`${MONTHS[now.getMonth()]} ${now.getFullYear()}`} />
          </div>

          {/* Operations by month */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-gray-800 text-sm mb-4">Operations by month</h2>
            {stats.byMonth.length === 0 ? (
              <p className="text-sm text-gray-400">No data yet.</p>
            ) : (
              <div className="flex items-end gap-3 h-40">
                {stats.byMonth.slice(-12).map((m) => (
                  <div key={`${m.year}-${m.month}`} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <span className="text-xs text-gray-500">{m.count}</span>
                    <div className="w-full bg-[#00ED64] rounded-t" style={{ height: `${Math.max(4, (m.count / maxMonth) * 120)}px` }} title={`${m.count} ops`} />
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">{MONTHS[m.month - 1]} {String(m.year).slice(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* By status */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-800 text-sm mb-3">By status</h2>
              <div className="space-y-2">
                {stats.byStatus.map((s) => (
                  <div key={s.status} className="flex items-center gap-2">
                    <span className="w-24 text-xs text-gray-500 capitalize shrink-0">{s.status}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div className={`h-2 ${statusClass(s.status)}`} style={{ width: `${(s.count / stats.count) * 100}%` }} />
                    </div>
                    <span className="w-8 text-xs text-gray-600 text-right">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* By currency */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-800 text-sm mb-3">By currency</h2>
              <div className="space-y-2">
                {stats.byCurrency.map((c) => (
                  <div key={c.currency} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 font-medium">{c.currency}</span>
                    <span className="text-gray-900 font-semibold">{fmt(c.amount, c.currency)}</span>
                    <span className="text-xs text-gray-400">{c.count} ops</span>
                  </div>
                ))}
                {stats.byCurrency.length === 0 && <p className="text-sm text-gray-400">No data yet.</p>}
              </div>
            </div>
          </div>

          {/* Recent activity + quick links */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800 text-sm">Recent payments</h2>
                <Link href="/system/merchant/payments" className="text-xs text-[#001E2B] font-medium hover:underline flex items-center gap-1">View all <ArrowRight size={12} /></Link>
              </div>
              {recent.length === 0 ? (
                <p className="text-sm text-gray-400">No payments yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {recent.map((s) => (
                    <li key={s.cardTransactionInstanceReference} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-700 truncate">{s.cardTransactionDescription ?? s.cardTransactionMaskedPanDisplay}</p>
                        <p className="text-xs text-gray-400">{new Date(s.cardTransactionDateTime).toLocaleString()} · {s.cardTransactionMaskedPanDisplay}</p>
                      </div>
                      <span className="font-semibold text-gray-900 text-sm whitespace-nowrap">{fmt(s.cardTransactionAmount.amount, s.cardTransactionAmount.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3">
              <Link href="/system/merchant/checkout" className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-4 hover:border-[#001E2B]/30 hover:shadow-sm transition-all">
                <ShoppingCart size={18} className="text-[#001E2B]" />
                <div><p className="text-sm font-medium text-gray-900">New checkout</p><p className="text-xs text-gray-400">Hosted payment page</p></div>
              </Link>
              <Link href="/system/merchant/links" className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-4 hover:border-[#001E2B]/30 hover:shadow-sm transition-all">
                <Link2 size={18} className="text-[#001E2B]" />
                <div><p className="text-sm font-medium text-gray-900">New payment link</p><p className="text-xs text-gray-400">Shareable URL</p></div>
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

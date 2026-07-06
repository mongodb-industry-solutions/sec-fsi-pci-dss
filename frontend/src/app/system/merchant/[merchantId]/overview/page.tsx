'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Receipt, TrendingUp, CreditCard, CalendarDays, ArrowRight, ShoppingCart, Link2, LayoutDashboard,
  Check, Clock, XCircle, ShieldCheck, MessageSquare, Info, Percent,
} from 'lucide-react';
import { SectionHeader } from '../../../../../components/SectionHeader';
import { useRequireActiveMerchant, isActiveOwner, type MerchantRecord } from '../../../../../lib/merchantContext';
import { api } from '../../../../../lib/api';

type Stats = {
  count: number; totalAmount: number; avgAmount: number;
  byStatus: Array<{ status: string; count: number; amount: number }>;
  byMonth: Array<{ year: number; month: number; count: number; amount: number }>;
  byCurrency: Array<{ currency: string; count: number; amount: number }>;
  // v18 B-06: commission revenue (SD-89) aggregated from paymentExecution fee (SD-65).
  commissionRevenue?: {
    total: number;
    count: number;
    byMonth: Array<{ year: number; month: number; count: number; amount: number }>;
  };
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

// ── Application status timeline (shown when merchant is not yet active) ────────

type StepState = 'done' | 'active' | 'rejected' | 'pending';

interface ReviewStep {
  label: string;
  sublabel?: string;
  state: StepState;
}

function buildReviewSteps(merchant: MerchantRecord): ReviewStep[] {
  const status = merchant.merchantAgreementStatus;
  const kyb = merchant.merchantAgreementKybCheck;
  const kybVerified = kyb?.merchantAgreementKybCheckStatus === 'verified';
  const kybRejected = kyb?.merchantAgreementKybCheckStatus === 'rejected';
  const isRejected = status === 'rejected';
  const isDecided = status === 'agreed' || status === 'active' || isRejected;
  const isUnderReview = status === 'under_review' || status === 'initiated';

  const submittedDate = merchant.recordCreatedDateTime
    ? new Date(merchant.recordCreatedDateTime).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const kybDate = kyb?.merchantAgreementKybCheckCompletedDate
    ? new Date(kyb.merchantAgreementKybCheckCompletedDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  let kybSublabel: string;
  let kybStepState: StepState;
  if (kybVerified) {
    kybSublabel = kybDate ? `Verified on ${kybDate}` : 'Business identity verified';
    kybStepState = 'done';
  } else if (kybRejected) {
    kybSublabel = 'Verification could not be completed';
    kybStepState = 'rejected';
  } else if (isDecided) {
    kybSublabel = 'Verification concluded';
    kybStepState = isRejected ? 'rejected' : 'done';
  } else {
    kybSublabel = 'Business identity verification in progress';
    kybStepState = isUnderReview ? 'active' : 'pending';
  }

  let decisionSublabel: string;
  let decisionStepState: StepState;
  if (status === 'agreed' || status === 'active') {
    decisionSublabel = 'Application approved';
    decisionStepState = 'done';
  } else if (isRejected) {
    decisionSublabel = merchant.merchantReviewNote || 'Application was not approved';
    decisionStepState = 'rejected';
  } else if (kybVerified && isUnderReview) {
    decisionSublabel = 'KYB complete, awaiting final review';
    decisionStepState = 'active';
  } else {
    decisionSublabel = 'Awaiting compliance officer review';
    decisionStepState = 'pending';
  }

  return [
    {
      label: 'Application Submitted',
      sublabel: submittedDate ? `Submitted on ${submittedDate}` : undefined,
      state: 'done',
    },
    {
      label: 'KYB Verification',
      sublabel: kybSublabel,
      state: kybStepState,
    },
    {
      label: 'Decision',
      sublabel: decisionSublabel,
      state: decisionStepState,
    },
  ];
}

const STEP_CIRCLE: Record<StepState, string> = {
  done:     'bg-green-500 text-white',
  active:   'bg-amber-500 text-white',
  rejected: 'bg-red-500 text-white',
  pending:  'bg-gray-200 text-gray-400',
};
const STEP_LABEL: Record<StepState, string> = {
  done:     'text-green-600',
  active:   'text-amber-600',
  rejected: 'text-red-600',
  pending:  'text-gray-400',
};
const STEP_LINE: Record<StepState, string> = {
  done:     'bg-green-400',
  active:   'bg-amber-300',
  rejected: 'bg-red-300',
  pending:  'bg-gray-200',
};

function StepIcon({ s }: { s: StepState }) {
  if (s === 'done') return <Check size={13} />;
  if (s === 'active') return <Clock size={13} />;
  if (s === 'rejected') return <XCircle size={13} />;
  return null;
}

function ApplicationStatusCard({ merchant }: { merchant: MerchantRecord }) {
  const steps = buildReviewSteps(merchant);
  const status = merchant.merchantAgreementStatus;
  const isRejected = status === 'rejected';
  const kyb = merchant.merchantAgreementKybCheck;
  const note = merchant.merchantReviewNote;

  const borderColor = isRejected ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50';
  const headerColor = isRejected ? 'text-red-800' : 'text-amber-800';
  const Icon = isRejected ? XCircle : Clock;
  const iconColor = isRejected ? 'text-red-500' : 'text-amber-500';

  return (
    <div className={`rounded-xl border p-5 space-y-5 ${borderColor}`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Icon size={16} className={iconColor} />
        <p className={`text-sm font-semibold ${headerColor}`}>
          {isRejected ? `${merchant.merchantName} was not approved` : `${merchant.merchantName} is under review`}
        </p>
      </div>

      {/* Timeline */}
      <div className="flex items-start gap-0">
        {steps.map((step, i) => (
          <div key={step.label} className="flex items-start flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0 min-w-[80px] sm:min-w-[110px]">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${STEP_CIRCLE[step.state]}`}>
                <StepIcon s={step.state} />
                {step.state === 'pending' && <span>{i + 1}</span>}
              </div>
              <span className={`text-[11px] font-semibold text-center leading-tight ${STEP_LABEL[step.state]}`}>
                {step.label}
              </span>
              {step.sublabel && (
                <span className="text-[10px] text-gray-500 text-center leading-tight px-1 hidden sm:block">
                  {step.sublabel}
                </span>
              )}
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mt-3.5 mx-1 rounded-full ${STEP_LINE[step.state]}`} />
            )}
          </div>
        ))}
      </div>

      {/* KYB details */}
      {kyb && (
        <div className="bg-white/60 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
            <ShieldCheck size={13} className="text-teal-600" /> KYB check details
          </div>
          {kyb.merchantAgreementKybCheckReference && (
            <p className="text-xs text-gray-500">Reference: <span className="font-mono text-gray-700">{kyb.merchantAgreementKybCheckReference}</span></p>
          )}
          {kyb.merchantAgreementKybCheckNotes && (
            <p className="text-xs text-gray-500">Notes: <span className="text-gray-700">{kyb.merchantAgreementKybCheckNotes}</span></p>
          )}
        </div>
      )}

      {/* Officer note */}
      {note && (
        <div className="flex items-start gap-2 text-xs">
          <MessageSquare size={13} className="shrink-0 mt-0.5 text-gray-500" />
          <span className="text-gray-700">{note}</span>
        </div>
      )}

      {/* Info footer */}
      {!isRejected && (
        <div className="flex items-start gap-1.5 text-xs text-amber-700">
          <Info size={12} className="shrink-0 mt-0.5" />
          <span>A compliance officer is reviewing your application. Typically completes within 2 business days. Other features will be enabled once approved.</span>
        </div>
      )}
      {isRejected && (
        <div className="flex items-start gap-1.5 text-xs text-red-700">
          <Info size={12} className="shrink-0 mt-0.5" />
          <span>Contact support if you believe this decision was made in error or to submit a new application.</span>
        </div>
      )}
    </div>
  );
}

// ── Overview page ─────────────────────────────────────────────────────────────

export default function OverviewSectionPage() {
  const ctx = useRequireActiveMerchant();
  const { token, merchant } = ctx;
  const active = isActiveOwner(ctx);
  const merchantId = merchant?.merchantAgreementInstanceReference ?? '';
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!merchantId || !active) { setLoading(false); return; }
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
  }, [merchantId, token, active]);

  useEffect(() => { if (merchantId) load(); }, [merchantId, load]);

  if (!merchant) return null;

  // Not yet active: show application review status instead of analytics.
  if (!active) {
    return (
      <div className="w-full px-5 sm:px-8 py-6 space-y-6">
        <SectionHeader
          icon={LayoutDashboard}
          title="Overview"
          description={`Application status for ${merchant.merchantName}.`}
          debugInfo="BIAN Merchant Agreement (SD-89) · Application lifecycle"
        />
        <ApplicationStatusCard merchant={merchant} />
      </div>
    );
  }

  // Active merchant: show analytics dashboard.
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
        <div className="text-center py-12 text-gray-400 text-sm">Loading analytics...</div>
      ) : !stats ? (
        <div className="text-center py-12 text-gray-400 text-sm">No analytics available.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={<Receipt size={14} />} label="Operations" value={String(stats.count)} sub="payments received" />
            <StatCard icon={<TrendingUp size={14} />} label="Gross volume"
              value={topCurrency ? fmt(topCurrency.amount, topCurrency.currency) : '-'}
              sub={stats.byCurrency.length > 1 ? `+${stats.byCurrency.length - 1} other currencies` : (topCurrency ? `${topCurrency.currency}` : undefined)} />
            <StatCard icon={<CreditCard size={14} />} label="Avg ticket"
              value={topCurrency ? fmt(stats.avgAmount, topCurrency.currency) : stats.avgAmount.toFixed(2)} sub="across all currencies" />
            <StatCard icon={<CalendarDays size={14} />} label="This month" value={String(thisMonth?.count ?? 0)} sub={`${MONTHS[now.getMonth()]} ${now.getFullYear()}`} />
          </div>

          {/* v18 B-06: commission revenue (SD-89) — recognized from the fee applied per operation (SD-65). */}
          {stats.commissionRevenue && stats.commissionRevenue.count > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Percent size={14} className="text-[#001E2B]" />
                <h2 className="font-semibold text-gray-800 text-sm">Commission revenue</h2>
              </div>
              <div className="flex flex-wrap items-end gap-8">
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {topCurrency ? fmt(stats.commissionRevenue.total, topCurrency.currency) : stats.commissionRevenue.total.toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{stats.commissionRevenue.count} operations with commission</p>
                </div>
                {stats.commissionRevenue.byMonth.length > 0 && (
                  <div className="flex-1 min-w-[240px]">
                    <ul className="divide-y divide-gray-100">
                      {stats.commissionRevenue.byMonth.slice(-6).map((m) => (
                        <li key={`${m.year}-${m.month}`} className="py-1.5 flex items-center justify-between text-sm">
                          <span className="text-gray-500">{MONTHS[m.month - 1]} {m.year}</span>
                          <span className="text-gray-900 font-medium">
                            {topCurrency ? fmt(m.amount, topCurrency.currency) : m.amount.toFixed(2)}
                          </span>
                          <span className="text-xs text-gray-400">{m.count} ops</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800 text-sm">Recent payments</h2>
                <Link href={`/system/merchant/${merchantId}/payments`} className="text-xs text-[#001E2B] font-medium hover:underline flex items-center gap-1">
                  View all <ArrowRight size={12} />
                </Link>
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
              <Link href={`/system/merchant/${merchantId}/checkout`} className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-4 hover:border-[#001E2B]/30 hover:shadow-sm transition-all">
                <ShoppingCart size={18} className="text-[#001E2B]" />
                <div><p className="text-sm font-medium text-gray-900">New checkout</p><p className="text-xs text-gray-400">Hosted payment page</p></div>
              </Link>
              <Link href={`/system/merchant/${merchantId}/links`} className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-4 hover:border-[#001E2B]/30 hover:shadow-sm transition-all">
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

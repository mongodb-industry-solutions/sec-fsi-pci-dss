'use client';
import { useEffect, useState } from 'react';
import { Briefcase, AlertTriangle, ShieldCheck, CheckCircle2, Receipt, TrendingUp, CalendarDays, Store, Clock, Plug, CreditCard, Landmark } from 'lucide-react';
import { api } from '../../lib/api';
import { StatCard, MonthlyBars, BreakdownBars } from './Stats';

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-blue-500', under_review: 'bg-amber-500', escalated: 'bg-orange-500',
  resolved_cleared: 'bg-green-500', resolved_fraud: 'bg-red-500', closed: 'bg-gray-400',
  authorized: 'bg-green-500', settled: 'bg-green-600', declined: 'bg-gray-400', disputed: 'bg-red-500', pending: 'bg-amber-500',
  active: 'bg-green-500', agreed: 'bg-emerald-500', rejected: 'bg-red-500', initiated: 'bg-amber-500', suspended: 'bg-orange-500',
};
const SEVERITY_COLOR: Record<string, string> = { critical: 'bg-red-600', high: 'bg-orange-500', medium: 'bg-amber-500', low: 'bg-green-500' };
const RISK_COLOR: Record<string, string> = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-green-500' };
const color = (map: Record<string, string>, k: string) => map[k] ?? 'bg-gray-400';

function monthly(dates: string[]) {
  const map = new Map<string, { year: number; month: number; count: number }>();
  for (const d of dates) {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) continue;
    const y = dt.getFullYear(); const m = dt.getMonth() + 1;
    const k = `${y}-${m}`;
    const e = map.get(k) ?? { year: y, month: m, count: 0 };
    e.count += 1; map.set(k, e);
  }
  return [...map.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

function tally<T>(items: T[], key: (t: T) => string) {
  const map = new Map<string, number>();
  for (const it of items) { const k = key(it); if (!k) continue; map.set(k, (map.get(k) ?? 0) + 1); }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function Loading() {
  return <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">Loading insights…</div>;
}

// ── Fraud investigation roles: L1 / L2 / auditor ────────────────────────────────
function FraudStats({ token }: { token: string }) {
  const [s, setS] = useState<Awaited<ReturnType<typeof api.fraud.stats>> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.fraud.stats(token).then(setS).catch(() => setS(null)).finally(() => setLoading(false)); }, [token]);
  if (loading) return <Loading />;
  if (!s) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Briefcase size={14} />} label="Total cases" value={String(s.total)} sub="all statuses" />
        <StatCard icon={<Clock size={14} />} label="Open" value={String(s.open + s.underReview)} sub="awaiting review" accent="text-amber-600" />
        <StatCard icon={<AlertTriangle size={14} />} label="Escalated" value={String(s.escalated)} sub="at Level 2" accent="text-orange-600" />
        <StatCard icon={<CheckCircle2 size={14} />} label="Resolved" value={String(s.resolvedFraud + s.resolvedCleared)} sub={`${s.resolvedFraud} fraud · ${s.resolvedCleared} cleared`} accent="text-green-600" />
      </div>
      <MonthlyBars title="Cases by month" data={s.byMonth} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownBars title="By status" total={s.total} items={s.byStatus.map((x) => ({ label: x.status.replace(/_/g, ' '), value: x.count, colorClass: color(STATUS_COLOR, x.status) }))} />
        <BreakdownBars title="By severity" total={s.total} items={s.bySeverity.map((x) => ({ label: x.severity, value: x.count, colorClass: color(SEVERITY_COLOR, x.severity) }))} />
      </div>
    </div>
  );
}

// ── Customer: own payment activity (backend scopes to the caller's email) ───────
type Txn = { cardTransactionAmount: { amount: number; currency: string }; cardTransactionDateTime: string; cardTransactionStatus: string };
function CustomerStats({ token }: { token: string }) {
  const [rows, setRows] = useState<Txn[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.transactions.list({ kind: 'card', limit: 100 }, token)
      .then((r) => setRows(r.results as unknown as Txn[]))
      .catch(() => setRows(null)).finally(() => setLoading(false));
  }, [token]);
  if (loading) return <Loading />;
  if (!rows || rows.length === 0) {
    return <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-400">No payment activity yet. Your transactions will appear here.</div>;
  }
  const now = new Date();
  const byCurrency = new Map<string, number>();
  for (const t of rows) byCurrency.set(t.cardTransactionAmount.currency, (byCurrency.get(t.cardTransactionAmount.currency) ?? 0) + t.cardTransactionAmount.amount);
  const topCur = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0];
  const months = monthly(rows.map((t) => t.cardTransactionDateTime));
  const thisMonth = months.find((m) => m.year === now.getFullYear() && m.month === now.getMonth() + 1);
  const fmt = (a: number, c: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(a);
  const statuses = tally(rows, (t) => t.cardTransactionStatus);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Receipt size={14} />} label="My payments" value={String(rows.length)} sub="total" />
        <StatCard icon={<TrendingUp size={14} />} label="Total spent" value={topCur ? fmt(topCur[1], topCur[0]) : '-'} sub={byCurrency.size > 1 ? `+${byCurrency.size - 1} currencies` : undefined} />
        <StatCard icon={<CalendarDays size={14} />} label="This month" value={String(thisMonth?.count ?? 0)} sub="payments" />
        <StatCard icon={<CheckCircle2 size={14} />} label="Last payment" value={rows[0] ? new Date(rows[0].cardTransactionDateTime).toLocaleDateString() : '-'} />
      </div>
      <MonthlyBars title="Payments by month" data={months} />
      <BreakdownBars title="By status" total={rows.length} items={statuses.map((x) => ({ ...x, colorClass: color(STATUS_COLOR, x.label) }))} />
    </div>
  );
}

// ── Merchant officer: merchant portfolio ────────────────────────────────────────
type MerchantRow = { merchantAgreementStatus: string; merchantRiskCategory?: string };
function OfficerStats({ token }: { token: string }) {
  const [rows, setRows] = useState<MerchantRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.merchants.list({ limit: 100 }, token)
      .then((r) => setRows(r.results as unknown as MerchantRow[]))
      .catch(() => setRows(null)).finally(() => setLoading(false));
  }, [token]);
  if (loading) return <Loading />;
  if (!rows) return null;
  const count = (pred: (m: MerchantRow) => boolean) => rows.filter(pred).length;
  const pending = count((m) => m.merchantAgreementStatus === 'under_review' || m.merchantAgreementStatus === 'initiated');
  const statuses = tally(rows, (m) => m.merchantAgreementStatus);
  const risks = tally(rows, (m) => m.merchantRiskCategory ?? '');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Store size={14} />} label="Merchants" value={String(rows.length)} sub="total" />
        <StatCard icon={<Clock size={14} />} label="Pending review" value={String(pending)} sub="awaiting KYB decision" accent="text-amber-600" />
        <StatCard icon={<CheckCircle2 size={14} />} label="Active" value={String(count((m) => m.merchantAgreementStatus === 'active'))} accent="text-green-600" />
        <StatCard icon={<AlertTriangle size={14} />} label="Rejected" value={String(count((m) => m.merchantAgreementStatus === 'rejected'))} accent="text-red-600" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownBars title="By status" total={rows.length} items={statuses.map((x) => ({ label: x.label.replace(/_/g, ' '), value: x.value, colorClass: color(STATUS_COLOR, x.label) }))} />
        <BreakdownBars title="By risk category" total={rows.length} items={risks.map((x) => ({ label: x.label || 'unknown', value: x.value, colorClass: color(RISK_COLOR, x.label) }))} />
      </div>
    </div>
  );
}

// ── Manager: integration portfolio ────────────────────────────────────
type IntegRow = { externalProviderArrangementType: string; externalProviderIsInternal: boolean; externalProviderHealthStatus?: string };
function ManagerStats({ token }: { token: string }) {
  const [rows, setRows] = useState<IntegRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.integrations.list(token)
      .then((r) => setRows((r as { integrations: IntegRow[] }).integrations))
      .catch(() => setRows(null)).finally(() => setLoading(false));
  }, [token]);
  if (loading) return <Loading />;
  if (!rows) return null;
  const internal = rows.filter((r) => r.externalProviderIsInternal).length;
  const healthy = rows.filter((r) => r.externalProviderHealthStatus === 'ok').length;
  const byHealth = tally(rows, (r) => r.externalProviderHealthStatus ?? 'unknown');
  const HEALTH_COLOR: Record<string, string> = { ok: 'bg-green-500', degraded: 'bg-amber-500', unreachable: 'bg-red-500', unknown: 'bg-gray-400' };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Plug size={14} />} label="Integrations" value={String(rows.length)} sub="registered" />
        <StatCard icon={<ShieldCheck size={14} />} label="Internal" value={String(internal)} sub="built-in providers" />
        <StatCard icon={<Plug size={14} />} label="External" value={String(rows.length - internal)} sub="third-party" />
        <StatCard icon={<CheckCircle2 size={14} />} label="Healthy" value={String(healthy)} accent="text-green-600" />
      </div>
      <BreakdownBars title="By health status" total={rows.length} items={byHealth.map((x) => ({ label: x.label, value: x.value, colorClass: HEALTH_COLOR[x.label] ?? 'bg-gray-400' }))} />
    </div>
  );
}

// ── Operations officer: card + payout-account inventory ─────────
// Aggregates only (counts by lifecycle status). No CHD/PII: statuses, never PAN/IBAN. If a capability
// is managed by an external provider the admin list returns 409 (managed_externally); that side is
// simply omitted (Promise.allSettled), so the panel still renders whatever is internally administered.
type OpsCard = { paymentCardStatus: string };
type OpsAcct = { payoutAccountStatus: string };
// The status breakdowns and derived counts below are computed from the first page only. Totals
// (cards.total / accts.total) are global; when they exceed the sample the derived figures are
// labeled "of first N" so they are not read as global counts.
const OPS_SAMPLE = 100;
function OperationsStats({ token }: { token: string }) {
  const [cards, setCards] = useState<{ results: OpsCard[]; total: number } | null>(null);
  const [accts, setAccts] = useState<{ results: OpsAcct[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.allSettled([
      api.modules.cardAdmin.list({ limit: OPS_SAMPLE }, token),
      api.modules.accountAdmin.list({ limit: OPS_SAMPLE }, token),
    ]).then(([c, a]) => {
      if (c.status === 'fulfilled') setCards({ results: c.value.results as unknown as OpsCard[], total: c.value.total });
      if (a.status === 'fulfilled') setAccts({ results: a.value.results as unknown as OpsAcct[], total: a.value.total });
    }).finally(() => setLoading(false));
  }, [token]);
  if (loading) return <Loading />;
  if (!cards && !accts) return null;
  const cardRows = cards?.results ?? [];
  const acctRows = accts?.results ?? [];
  const cardCount = (s: string) => cardRows.filter((c) => c.paymentCardStatus === s).length;
  const acctCount = (s: string) => acctRows.filter((a) => a.payoutAccountStatus === s).length;
  const cardStatuses = tally(cardRows, (c) => c.paymentCardStatus);
  const acctStatuses = tally(acctRows, (a) => a.payoutAccountStatus);
  const cardsSampled = (cards?.total ?? 0) > cardRows.length;
  const acctsSampled = (accts?.total ?? 0) > acctRows.length;
  const cardSampleNote = cardsSampled ? `of first ${cardRows.length}` : undefined;
  const acctSampleNote = acctsSampled ? `of first ${acctRows.length}` : undefined;
  // Only render a section when its dataset is actually present. A capability managed by an external
  // provider returns 409 (list rejected via Promise.allSettled), so that side stays null and is
  // omitted rather than shown as a misleading "0" with an empty breakdown.
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards && <StatCard icon={<CreditCard size={14} />} label="Cards" value={String(cards.total)} sub="on file (excl. revoked)" />}
        {cards && <StatCard icon={<CheckCircle2 size={14} />} label="Active cards" value={String(cardCount('active'))} accent="text-green-600" sub={cardSampleNote} />}
        {cards && <StatCard icon={<Clock size={14} />} label="Suspended cards" value={String(cardCount('suspended'))} accent="text-orange-600" sub={cardSampleNote} />}
        {accts && <StatCard icon={<Landmark size={14} />} label="Payout accounts" value={String(accts.total)} sub={acctsSampled ? `${acctCount('active')} active (of first ${acctRows.length})` : `${acctCount('active')} active`} />}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards && <BreakdownBars title={cardsSampled ? `Cards by status (first ${cardRows.length} of ${cards.total})` : 'Cards by status'} total={cardRows.length} items={cardStatuses.map((x) => ({ label: x.label.replace(/_/g, ' '), value: x.value, colorClass: color(STATUS_COLOR, x.label) }))} />}
        {accts && <BreakdownBars title={acctsSampled ? `Accounts by status (first ${acctRows.length} of ${accts.total})` : 'Accounts by status'} total={acctRows.length} items={acctStatuses.map((x) => ({ label: x.label.replace(/_/g, ' '), value: x.value, colorClass: color(STATUS_COLOR, x.label) }))} />}
      </div>
    </div>
  );
}

export function RoleStats({ role, token }: { role: string; token: string }) {
  if (!token) return null;
  if (role === 'level1_analyst' || role === 'level2_investigator' || role === 'security_auditor') return <FraudStats token={token} />;
  if (role === 'customer') return <CustomerStats token={token} />;
  if (role === 'merchant_officer') return <OfficerStats token={token} />;
  if (role === 'operations_officer') return <OperationsStats token={token} />;
  if (role === 'manager') return <ManagerStats token={token} />;
  return null;
}

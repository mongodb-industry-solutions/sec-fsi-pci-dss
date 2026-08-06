'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, ClipboardList, ArrowDownLeft, ArrowUpRight, SlidersHorizontal, HandCoins } from 'lucide-react';
import { SectionHeader } from '../../../../components/SectionHeader';
import { api } from '../../../../lib/api';
import { getToken, decodeToken } from '../../../../lib/auth';
import { Pagination } from '../../../../components/Pagination';
import { useDebugMode } from '../../../../lib/debugMode';

// ── Unified history row ───────────────────────────────────────────────────────
// Each row is either a card transaction (SD-254) or a P2P transfer (SD-65).
type RowCategory = 'card' | 'p2p' | 'rtp';

interface HistoryRow {
  id: string;
  category: RowCategory;
  createdAt: string;
  amount: number;
  currency: string;
  status: string;
  // Card-specific
  merchant?: string;
  mcc?: string;
  channel?: string;
  acceptanceMethod?: string;
  cardTransactionType?: string;
  maskedPan?: string;
  fraudCaseCreated?: boolean;
  caseStatus?: string;
  caseRef?: string;
  customerNote?: string | null;
  paymentReference?: string | null;
  concept?: string | null;
  // P2P-specific
  p2pDirection?: 'sent' | 'received';
  p2pRail?: string | null;
  p2pNote?: string | null;
  // RTP-specific (Request to Pay). rtpRole: 'requested' = I requested money (incoming to me);
  // 'to_approve' = someone requested money from me (I must approve to pay, outgoing).
  rtpRole?: 'requested' | 'to_approve';
  rtpRequestRef?: string;
  linkedExecutionRef?: string; // the SD-65 execution created on accept (money leg of this RTP)
}

// ── Card transaction type badges ──────────────────────────────────────────────
const TYPE_LABELS: Record<string, string> = {
  purchase:         'Purchase',
  refund:           'Refund',
  cash_advance:     'Cash Advance',
  balance_transfer: 'Transfer',
  fee:              'Fee',
  adjustment:       'Adjustment',
};
const TYPE_COLORS: Record<string, string> = {
  purchase:         'bg-blue-50 text-blue-700 border border-blue-200',
  refund:           'bg-green-50 text-green-700 border border-green-200',
  cash_advance:     'bg-amber-50 text-amber-700 border border-amber-200',
  balance_transfer: 'bg-purple-50 text-purple-700 border border-purple-200',
  fee:              'bg-gray-100 text-gray-600',
  adjustment:       'bg-gray-100 text-gray-600',
};

// ── Payment authorization status ──────────────────────────────────────────────
const PAYMENT_STATUS: Record<string, { label: string; color: string }> = {
  authorized: { label: 'Authorized',  color: 'bg-green-100 text-green-800' },
  settled:    { label: '✓ Settled',   color: 'bg-emerald-100 text-emerald-800 font-semibold' },
  captured:   { label: 'Captured',    color: 'bg-teal-100 text-teal-800' },
  pending:    { label: 'Pending',     color: 'bg-amber-100 text-amber-800' },
  declined:   { label: 'Declined',    color: 'bg-red-100 text-red-800' },
  voided:     { label: 'Voided',      color: 'bg-gray-100 text-gray-500' },
  refunded:   { label: 'Refunded',    color: 'bg-purple-100 text-purple-700' },
  failed:     { label: 'Failed',      color: 'bg-red-100 text-red-800' },
  expired:    { label: 'Expired',     color: 'bg-gray-100 text-gray-500' },
  completed:  { label: '✓ Completed', color: 'bg-emerald-100 text-emerald-800 font-semibold' },
};

// ── Fraud / risk status (BIAN SD-83) ──────────────────────────────────────────
const FRAUD_STATUS: Record<string, { label: string; color: string; icon: string }> = {
  open:             { label: 'Flagged for review',  color: 'bg-amber-100 text-amber-800',  icon: '⚠' },
  under_review:     { label: 'Flagged for review',  color: 'bg-amber-100 text-amber-800',  icon: '⚠' },
  escalated:        { label: 'Under investigation', color: 'bg-orange-100 text-orange-800', icon: '🔍' },
  resolved_fraud:   { label: 'Confirmed fraud',     color: 'bg-red-100 text-red-800',      icon: '🛑' },
  resolved_cleared: { label: 'Cleared, legitimate', color: 'bg-green-100 text-green-800',  icon: '✓' },
  closed:           { label: 'Case closed',         color: 'bg-gray-100 text-gray-700',    icon: '•' },
};

function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

// ── Card money direction (SD-254) ─────────────────────────────────────────────
// Any operation that debits the funding account is shown as a discount (−, red), mirroring the P2P
// "sent" rows. refund / adjustment are credits (+, green). Statuses that never moved money (declined,
// failed, voided, expired) render neutral (no sign) so we don't show −$X on an uncharged transaction.
const CARD_CREDIT_TYPES = new Set(['refund', 'adjustment']);
const CARD_NON_MOVEMENT_STATUS = new Set(['declined', 'failed', 'voided', 'expired']);
function cardDirection(type: string | undefined, status: string): 'debit' | 'credit' | 'neutral' {
  if (CARD_NON_MOVEMENT_STATUS.has(status)) return 'neutral';
  if (type && CARD_CREDIT_TYPES.has(type)) return 'credit';
  return 'debit';
}

// Two-axis taxonomy (method vs state). TYPE/method is derived per row; STATUS is the lifecycle state
// (settled, pending approval, rejected… are STATES, not types). "Payout" = a P2P/bank execution.
type TypeKey = 'card' | 'payment_link' | 'redirect' | 'p2p' | 'bank' | 'rtp';
const METHOD_LABELS: Record<TypeKey, string> = {
  card:         'Card',
  payment_link: 'Payment Link',
  redirect:     'Redirect / Checkout',
  p2p:          'P2P transfer',
  bank:         'Bank transfer',
  rtp:          'Request to Pay',
};
const BANK_RAILS = ['sepa', 'ach', 'swift', 'local_bank'];
function rowTypeKey(r: HistoryRow): TypeKey {
  if (r.category === 'rtp') return 'rtp';
  if (r.category === 'p2p') return BANK_RAILS.includes((r.p2pRail ?? '').toLowerCase()) ? 'bank' : 'p2p';
  // card: classify by the persisted acceptance method (payment link / redirect-checkout); else plain card.
  const m = (r.acceptanceMethod ?? '').toLowerCase();
  if (m === 'payment_link') return 'payment_link';
  if (m === 'redirect_checkout') return 'redirect';
  return 'card';
}

// Money direction from the current user's perspective (simple in/out for casual users).
function rowDirection(r: HistoryRow): 'in' | 'out' | 'neutral' {
  if (r.category === 'rtp') return r.rtpRole === 'requested' ? 'in' : 'out';
  if (r.category === 'p2p') return r.p2pDirection === 'received' ? 'in' : 'out';
  // card: refunds/adjustments are credits (in); everything else is a debit (out); non-movement neutral.
  if (['declined', 'failed', 'voided', 'expired'].includes(r.status)) return 'neutral';
  if (r.cardTransactionType && ['refund', 'adjustment'].includes(r.cardTransactionType)) return 'in';
  return 'out';
}

// Canonical, deduplicated lifecycle-status groups spanning every BIAN state across card (SD-254),
// payment execution (SD-65) and RTP (SD-65 intent). Each group's `key` is the filter value; `states`
// are the raw statuses it matches. This avoids a duplicated "Settled" (settled/completed/payment_settled)
// and lists every possible state, not only the ones currently present in the loaded rows.
const STATUS_GROUPS: { key: string; label: string; states: string[] }[] = [
  { key: 'pending_approval', label: 'Pending approval', states: ['created', 'validated', 'presented', 'delivered', 'viewed'] },
  { key: 'pending',          label: 'Pending',             states: ['pending'] },
  { key: 'authorized',       label: 'Authorized',          states: ['authorized', 'accepted'] },
  { key: 'in_flight',        label: 'In flight / processing', states: ['in_flight', 'routing', 'submitted', 'payment_initiated', 'payment_processing', 'captured'] },
  { key: 'settled',          label: 'Settled',             states: ['settled', 'completed', 'payment_settled'] },
  { key: 'refunded',         label: 'Refunded',            states: ['refunded'] },
  { key: 'reversed',         label: 'Reversed',            states: ['reversed'] },
  { key: 'declined',         label: 'Declined',            states: ['declined'] },
  { key: 'failed',           label: 'Failed',              states: ['failed', 'payment_failed', 'exception'] },
  { key: 'rejected',         label: 'Rejected',            states: ['rejected'] },
  { key: 'cancelled',        label: 'Cancelled / voided',  states: ['cancelled', 'voided'] },
  { key: 'expired',          label: 'Expired',             states: ['expired'] },
  { key: 'disputed',         label: 'Disputed',            states: ['disputed'] },
];
const STATUS_STATES_BY_KEY: Record<string, string[]> = Object.fromEntries(STATUS_GROUPS.map(g => [g.key, g.states]));

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TransactionHistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [directionFilter, setDirectionFilter] = useState<'' | 'in' | 'out'>('');
  const [typeFilter, setTypeFilter] = useState<'' | TypeKey>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fraudFilter, setFraudFilter] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { debugMode } = useDebugMode();

  function handleLimitChange(n: number) { setPageSize(n); setPage(1); }
  function applySearch() { setPage(1); setQ(qInput.trim()); }
  function clearAll() { setQInput(''); setQ(''); setDirectionFilter(''); setTypeFilter(''); setStatusFilter(''); setFraudFilter(''); setPage(1); }

  useEffect(() => {
    const load = async () => {
      const t = getToken() ?? '';
      const u = t ? decodeToken(t) : null;

      const cardPromise = api.transactions.listAll({ email: u?.email, limit: 200 }, t).then(res =>
        res.results.map((r) => {
          const row = r as {
            cardTransactionInstanceReference: string;
            cardTransactionAmount: { amount: number; currency: string };
            cardTransactionDateTime: string;
            cardTransactionStatus: string;
            cardTransactionType?: string;
            cardTransactionMerchantName: string;
            cardTransactionMerchantCategoryCode?: string;
            cardTransactionChannel?: string;
            cardTransactionMaskedPanDisplay: string;
            cardTransactionDescription?: string;
            fraudCaseCreated?: boolean;
            fraudDiagnosisCaseStatus?: string | null;
            fraudDiagnosisCaseReference?: string | null;
          };
          return {
            id:                  row.cardTransactionInstanceReference,
            category:            'card' as RowCategory,
            createdAt:           row.cardTransactionDateTime,
            amount:              row.cardTransactionAmount?.amount ?? 0,
            currency:            row.cardTransactionAmount?.currency ?? 'USD',
            status:              row.cardTransactionStatus,
            merchant:            row.cardTransactionMerchantName,
            mcc:                 row.cardTransactionMerchantCategoryCode ?? '',
            channel:             row.cardTransactionChannel ?? '',
            acceptanceMethod:    (row as { cardTransactionAcceptanceMethod?: string }).cardTransactionAcceptanceMethod ?? '',
            cardTransactionType: row.cardTransactionType,
            maskedPan:           row.cardTransactionMaskedPanDisplay,
            concept:             row.cardTransactionDescription ?? null,
            fraudCaseCreated:    !!row.fraudCaseCreated,
            caseStatus:          row.fraudDiagnosisCaseStatus ?? undefined,
            caseRef:             row.fraudDiagnosisCaseReference ?? undefined,
          } satisfies HistoryRow;
        })
      ).catch(() => [] as HistoryRow[]);

      const p2pPromise = u?.partyRef
        ? api.accounts.transfers(u.partyRef, t, { limit: 100 }).then(res =>
            res.results.map((r) => ({
              id:           r.paymentExecutionInstanceReference,
              category:     'p2p' as RowCategory,
              createdAt:    r.initiatedAt ?? r.completedAt ?? new Date().toISOString(),
              amount:       r.grossAmount,
              currency:     r.currency,
              status:       r.paymentExecutionStatus,
              p2pDirection: r.direction,
              p2pRail:      r.paymentExecutionRail,
              p2pNote:      r.paymentExecutionRemittanceInformation ?? r.routingNote,
            } satisfies HistoryRow))
          ).catch(() => [] as HistoryRow[])
        : Promise.resolve([] as HistoryRow[]);

      // RTP (Request to Pay): both what I requested (outbox) and what I must approve (inbox).
      const rtpPromise = t
        ? Promise.all([
            api.rtp.list({ box: 'outbox' }, t).then(r => (r.results ?? []).map(x => ({ x, role: 'requested' as const }))).catch(() => []),
            api.rtp.list({ box: 'inbox' }, t).then(r => (r.results ?? []).map(x => ({ x, role: 'to_approve' as const }))).catch(() => []),
          ]).then(([out, inb]) => {
            const seen = new Set<string>();
            return [...out, ...inb].filter(({ x }) => {
              if (seen.has(x.paymentRequestInstanceReference)) return false;
              seen.add(x.paymentRequestInstanceReference); return true;
            }).map(({ x, role }) => ({
              id:            x.paymentRequestInstanceReference,
              category:      'rtp' as RowCategory,
              createdAt:     x.recordCreatedDateTime ?? new Date().toISOString(),
              amount:        x.amount,
              currency:      x.currency,
              status:        x.status,
              rtpRole:       role,
              rtpRequestRef: x.paymentRequestInstanceReference,
              linkedExecutionRef: x.linkedPaymentExecutionReference,
              concept:       x.purpose ?? null,
            } satisfies HistoryRow));
          })
        : Promise.resolve([] as HistoryRow[]);

      const [cards, p2p, rtp] = await Promise.all([cardPromise, p2pPromise, rtpPromise]);
      // Presentation-only de-dup (BIAN keeps the RTP intent and the SD-65 execution as SEPARATE
      // records): when an RTP has a linked execution, show ONLY the RTP row and hide that execution
      // row so the same movement is not listed twice. The RTP detail links through to the execution.
      const linkedExecRefs = new Set(rtp.map((r) => r.linkedExecutionRef).filter(Boolean) as string[]);
      const p2pDeduped = p2p.filter((r) => !linkedExecRefs.has(r.id));
      const merged = [...cards, ...p2pDeduped, ...rtp].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setRows(merged);
      setLoading(false);
    };
    load();
  }, []);

  // ── Filter logic ────────────────────────────────────────────────────────────
  const fraudKeys = Array.from(new Set(
    rows.filter(r => r.fraudCaseCreated && r.caseStatus).map(r => r.caseStatus as string)
  ));
  const ql = q.toLowerCase();

  const filtered = rows.filter((r) => {
    if (directionFilter && rowDirection(r) !== directionFilter) return false;
    if (typeFilter && rowTypeKey(r) !== typeFilter) return false;
    // Status is matched by canonical group (a group can cover several raw statuses, e.g. Settled).
    if (statusFilter) {
      const states = STATUS_STATES_BY_KEY[statusFilter];
      if (states) { if (!states.includes(r.status)) return false; }
      else if (r.status !== statusFilter) return false;
    }
    if (fraudFilter === 'none' && r.fraudCaseCreated) return false;
    if (fraudFilter === 'any' && !r.fraudCaseCreated) return false;
    if (fraudFilter && fraudFilter !== 'none' && fraudFilter !== 'any' && r.caseStatus !== fraudFilter) return false;
    if (!ql) return true;
    if (r.category === 'card') {
      return (
        (r.merchant ?? '').toLowerCase().includes(ql) ||
        (r.maskedPan ?? '').toLowerCase().includes(ql) ||
        (r.concept ?? '').toLowerCase().includes(ql) ||
        (r.paymentReference ?? '').toLowerCase().includes(ql) ||
        (r.caseRef ?? '').toLowerCase().includes(ql) ||
        r.id.toLowerCase().includes(ql) ||
        String(r.amount).includes(ql)
      );
    }
    // p2p + rtp
    return (
      (r.p2pNote ?? '').toLowerCase().includes(ql) ||
      (r.concept ?? '').toLowerCase().includes(ql) ||
      r.id.toLowerCase().includes(ql) ||
      String(r.amount).includes(ql) ||
      (r.p2pDirection ?? '').includes(ql) ||
      (r.rtpRole ?? '').includes(ql)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const isFiltering = !!(q || qInput || directionFilter || typeFilter || statusFilter || fraudFilter);
  const showCardFilters = typeFilter === '' || typeFilter === 'card' || typeFilter === 'payment_link' || typeFilter === 'redirect';

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-5 sm:px-8 lg:px-12 py-6">
        <div className="mb-5">
          <SectionHeader
            icon={ClipboardList}
            title="Payment History"
            description="Card transactions and P2P transfers, your complete payment record."
            debugInfo="BIAN SD-254 Card Transaction · SD-65 Payment Execution · PCI DSS Req 7.2"
            actions={
              <Link href="/system/payment" className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-[#001E2B] text-[#001E2B] hover:bg-[#001E2B] hover:text-[#00ED64] transition-colors font-medium">
                <Plus size={14} />
                New Payment
              </Link>
            }
          />
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading your payment history…</div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-xl border p-6 text-center text-gray-500">
            <p className="mb-2">No transactions yet.</p>
            <Link href="/system/payment" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
              Make your first payment
            </Link>
          </div>
        ) : (
          <>
            {/* ── Filters ──────────────────────────────────────────────────── */}
            {/* Simple row (everyone): search + direction (in/out) + advanced toggle. */}
            <div className="flex flex-col sm:flex-row gap-2 mb-2 flex-wrap items-center">
              <input
                type="text"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }}
                placeholder="Search by merchant, card, reference, id…"
                className="flex-1 min-w-[160px] border rounded-lg px-3 py-2 text-sm"
              />
              {/* Direction segmented control: simple in/out for casual users. */}
              <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                {([['', 'All'], ['in', 'In'], ['out', 'Out']] as const).map(([val, label]) => (
                  <button key={val || 'all'} onClick={() => { setDirectionFilter(val); setPage(1); }}
                    className={`inline-flex items-center gap-1 px-3 py-2 transition-colors ${directionFilter === val ? 'bg-[#001E2B] text-[#00ED64]' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {val === 'in' && <ArrowDownLeft size={14} />}{val === 'out' && <ArrowUpRight size={14} />}{label}
                  </button>
                ))}
              </div>
              <button onClick={applySearch} className="px-4 py-2 rounded-lg bg-[#001E2B] text-[#00ED64] text-sm font-semibold">Search</button>
              <button onClick={() => setShowAdvanced(v => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${showAdvanced ? 'border-[#001E2B] text-[#001E2B]' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                <SlidersHorizontal size={14} /> Advanced
              </button>
              {isFiltering && (
                <button onClick={clearAll} className="px-3 py-2 rounded-lg border text-sm text-gray-500 hover:bg-gray-50 transition-colors">Clear</button>
              )}
            </div>

            {/* Advanced row (power users): type / status / fraud. */}
            {showAdvanced && (
              <div className="flex flex-col sm:flex-row gap-2 mb-5 flex-wrap">
                <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value as typeof typeFilter); setFraudFilter(''); setPage(1); }}
                  className="border rounded-lg px-3 py-2 text-sm bg-white" title="Transaction type / method">
                  <option value="">All types</option>
                  {(Object.keys(METHOD_LABELS) as TypeKey[]).map((k) => (
                    <option key={k} value={k}>{METHOD_LABELS[k]}</option>
                  ))}
                </select>
                <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                  className="border rounded-lg px-3 py-2 text-sm bg-white" title="Lifecycle status">
                  <option value="">All statuses</option>
                  {STATUS_GROUPS.map((g) => (
                    <option key={g.key} value={g.key}>{g.label}</option>
                  ))}
                </select>
                {showCardFilters && (
                  <select value={fraudFilter} onChange={(e) => { setFraudFilter(e.target.value); setPage(1); }}
                    className="border rounded-lg px-3 py-2 text-sm bg-white" title="Fraud / risk status">
                    <option value="">All fraud statuses</option>
                    <option value="any">Flagged as fraud (any)</option>
                    {fraudKeys.map((k) => (
                      <option key={k} value={k}>{FRAUD_STATUS[k]?.label ?? k.replace(/_/g, ' ')}</option>
                    ))}
                    <option value="none">No fraud case</option>
                  </select>
                )}
              </div>
            )}
            {!showAdvanced && <div className="mb-5" />}

            {filtered.length === 0 ? (
              <div className="bg-white rounded-xl border p-6 text-center text-gray-500">
                No entries match your filters.
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-5">
                  {paginated.map((row) => {
                    if (row.category === 'card') {
                      const pay = PAYMENT_STATUS[row.status] ?? { label: row.status.replace(/_/g, ' '), color: 'bg-gray-100 text-gray-700' };
                      const fraud = (row.fraudCaseCreated && row.caseStatus)
                        ? (FRAUD_STATUS[row.caseStatus] ?? { label: row.caseStatus.replace(/_/g, ' '), color: 'bg-gray-100 text-gray-700', icon: '⚠' })
                        : null;
                      return (
                        <Link key={row.id} href={`/system/payment/history/${row.id}`}
                          className="group block bg-white rounded-xl border p-4 hover:border-[#001E2B]/30 hover:shadow-md transition-all cursor-pointer">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900 truncate">{row.merchant}</p>
                              <p className="text-xs text-gray-500">{new Date(row.createdAt).toLocaleString()}</p>
                              {row.concept && (
                                <p className="text-xs text-gray-500 mt-0.5 truncate">Concept: {row.concept}</p>
                              )}
                              {row.paymentReference && (
                                <p className="text-xs text-gray-400 mt-0.5">Ref: {row.paymentReference}</p>
                              )}
                            </div>
                            <div className="flex items-start gap-3 shrink-0">
                              <div className="text-right">
                                {(() => {
                                  const dir = cardDirection(row.cardTransactionType, row.status);
                                  const cls = dir === 'debit' ? 'text-red-600' : dir === 'credit' ? 'text-green-700' : 'text-gray-900';
                                  const sign = dir === 'debit' ? '−' : dir === 'credit' ? '+' : '';
                                  return <p className={`font-bold ${cls}`}>{sign}{fmtAmount(row.amount, row.currency)}</p>;
                                })()}
                                <p className="text-xs text-gray-500 font-mono">{row.maskedPan}</p>
                              </div>
                              <span className="text-gray-300 group-hover:text-[#001E2B] transition-colors text-lg leading-none mt-0.5">›</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${pay.color}`} title="Payment authorization status">💳 {pay.label}</span>
                            {fraud && (
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${fraud.color}`} title="Fraud / risk review status">{fraud.icon} {fraud.label}</span>
                            )}
                            {row.cardTransactionType && (
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${TYPE_COLORS[row.cardTransactionType] ?? 'bg-gray-100 text-gray-600'}`}>
                                {TYPE_LABELS[row.cardTransactionType] ?? row.cardTransactionType.replace(/_/g, ' ')}
                              </span>
                            )}
                            {row.caseRef && <span className="text-xs text-gray-400 font-mono">{row.caseRef}</span>}
                            <span className="text-xs text-gray-400 capitalize">{row.channel}</span>
                          </div>
                          {row.customerNote && (
                            <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-2 text-xs text-blue-800">
                              <span className="font-semibold">✉ Security team: </span>{row.customerNote}
                            </div>
                          )}
                          {debugMode && <p className="mt-1.5 text-xs font-mono text-gray-400 truncate">id: {row.id}</p>}
                        </Link>
                      );
                    }

                    if (row.category === 'rtp') {
                      const pendingApproval = ['created', 'validated', 'presented', 'delivered', 'viewed'].includes(row.status);
                      const isIncoming = row.rtpRole === 'requested'; // I requested → money comes to me
                      const rtpStatusColor = pendingApproval ? 'bg-amber-100 text-amber-800'
                        : row.status === 'payment_settled' ? 'bg-green-100 text-green-800'
                        : ['rejected', 'cancelled', 'expired', 'payment_failed'].includes(row.status) ? 'bg-red-100 text-red-700'
                        : 'bg-blue-100 text-blue-800';
                      const rtpStatusLabel = pendingApproval
                        ? (isIncoming ? 'Awaiting payer approval' : 'Pending your approval')
                        : row.status.replace(/_/g, ' ');
                      return (
                        <Link key={row.id} href={`/system/payment/history/${encodeURIComponent(row.rtpRequestRef ?? row.id)}`}
                          className="group block bg-white rounded-xl border p-4 hover:border-[#001E2B]/30 hover:shadow-md transition-all cursor-pointer">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900 truncate flex items-center gap-1.5">
                                {isIncoming ? <ArrowDownLeft size={15} className="text-green-700 shrink-0" /> : <ArrowUpRight size={15} className="text-red-600 shrink-0" />}
                                {isIncoming ? 'Money requested (you receive)' : 'Request to approve (you pay)'}
                              </p>
                              <p className="text-xs text-gray-500">{new Date(row.createdAt).toLocaleString()}</p>
                              {row.concept && <p className="text-xs text-gray-400 mt-0.5 truncate">{row.concept}</p>}
                            </div>
                            <div className="flex items-start gap-3 shrink-0">
                              <div className="text-right">
                                <p className={`font-bold ${isIncoming ? 'text-green-700' : 'text-red-600'}`}>
                                  {isIncoming ? '+' : '−'}{fmtAmount(row.amount, row.currency)}
                                </p>
                              </div>
                              <span className="text-gray-300 group-hover:text-[#001E2B] transition-colors text-lg leading-none mt-0.5">›</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium bg-purple-50 text-purple-700 border border-purple-200"><HandCoins size={12} /> Request to Pay</span>
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${rtpStatusColor}`}>{rtpStatusLabel}</span>
                          </div>
                          {debugMode && <p className="mt-1.5 text-xs font-mono text-gray-400 truncate">id: {row.id}</p>}
                        </Link>
                      );
                    }

                    const pay = PAYMENT_STATUS[row.status] ?? { label: row.status.replace(/_/g, ' '), color: 'bg-gray-100 text-gray-700' };
                    const isSent = row.p2pDirection === 'sent';
                    return (
                      <Link key={row.id} href={`/system/payment/history/${row.id}`}
                        className="group block bg-white rounded-xl border p-4 hover:border-[#001E2B]/30 hover:shadow-md transition-all cursor-pointer">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 truncate">
                              {isSent ? '↑ P2P Transfer sent' : '↓ P2P Transfer received'}
                            </p>
                            <p className="text-xs text-gray-500">{new Date(row.createdAt).toLocaleString()}</p>
                            {row.p2pNote && <p className="text-xs text-gray-400 mt-0.5 truncate">{row.p2pNote}</p>}
                          </div>
                          <div className="flex items-start gap-3 shrink-0">
                            <div className="text-right">
                              <p className={`font-bold ${isSent ? 'text-red-600' : 'text-green-700'}`}>
                                {isSent ? '−' : '+'}{fmtAmount(row.amount, row.currency)}
                              </p>
                              {row.p2pRail && <p className="text-xs text-gray-400 capitalize">{row.p2pRail.replace(/_/g, ' ')}</p>}
                            </div>
                            <span className="text-gray-300 group-hover:text-[#001E2B] transition-colors text-lg leading-none mt-0.5">›</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${isSent ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                            ↕ P2P Transfer
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${pay.color}`}>{pay.label}</span>
                        </div>
                        {debugMode && <p className="mt-1.5 text-xs font-mono text-gray-400 truncate">id: {row.id}</p>}
                      </Link>
                    );
                  })}
                </div>

                <Pagination
                  page={page}
                  totalPages={totalPages}
                  total={filtered.length}
                  limit={pageSize}
                  onPageChange={setPage}
                  onLimitChange={handleLimitChange}
                  limitOptions={[5, 10, 20, 50]}
                  noun="entries"
                />
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

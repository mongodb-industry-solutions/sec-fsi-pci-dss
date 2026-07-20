// History (C-17): the user's operations with status + applied commission.
import { redirect } from 'next/navigation';
import { ReceiptText, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { PspClient, PspError } from '@/lib/PspClient';
import { getSession, hasScope } from '@/lib/session';
import { ScopeMissing, PspUnavailable } from '@/components/ScopeGate';
import { Chip, EmptyState, InfoHint } from '@/components/ui/Bits';
import CopyButton from '@/components/ui/CopyButton';
import { MERCHANT_COMMISSION_RATE } from '@/config/products';
import RtpActions from '../request-to-pay/RtpActions';

const RTP_PENDING = ['created', 'validated', 'presented', 'delivered', 'viewed'];

function money(a?: { amount: number; currency: string } | number, currency?: string) {
  if (a == null) return 'n/a';
  if (typeof a === 'number') return `${currency ?? ''} ${a.toFixed(2)}`.trim();
  return `${a.currency} ${a.amount.toFixed(2)}`;
}

// Shorten an internal reference for display while keeping the full value available (title/copy).
function shortRef(id?: string): string {
  if (!id) return 'n/a';
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

// Human-friendly labels for raw PSP/RTP status codes (snake_case → Title Case with clear wording).
const STATUS_LABEL: Record<string, string> = {
  // RTP lifecycle
  created: 'Created',
  validated: 'Validated',
  presented: 'Awaiting approval',
  delivered: 'Awaiting approval',
  viewed: 'Awaiting approval',
  accepted: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Expired',
  payment_initiated: 'Processing',
  payment_settled: 'Completed',
  payment_failed: 'Failed',
  reversed: 'Reversed',
  disputed: 'Disputed',
  // Execution / card statuses
  settled: 'Completed',
  completed: 'Completed',
  processing: 'Processing',
  initiated: 'Processing',
  pending: 'Pending',
  failed: 'Failed',
  declined: 'Declined',
  authorized: 'Authorized',
};

function statusLabel(s?: string): string {
  if (!s) return 'n/a';
  return STATUS_LABEL[s.toLowerCase()] ?? s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

// Map a PSP status string to a chip tone.
function statusTone(s?: string): 'ok' | 'warn' | 'err' | 'neutral' {
  const v = (s ?? '').toLowerCase();
  if (/(complete|settled|success|paid|done)/.test(v)) return 'ok';
  if (/(fail|declined|error|cancel|reject)/.test(v)) return 'err';
  if (/(pending|processing|initiat|hold)/.test(v)) return 'warn';
  return 'neutral';
}

export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect('/');
  if (!hasScope(session, 'read:transactions')) return <ScopeMissing scope="read:transactions" />;

  const c = await PspClient.fromSession();
  let results: any[] = [];
  let error: string | undefined;
  // The PSP /transactions merchant channel already returns a MERGED, merchant-isolated history
  // (SD-65 executions + the party's card transactions made THROUGH this merchant). We only need to
  // request a high enough page size so nothing is truncated (default was 20).
  try {
    const data = await c!.listHistory(1, 100);
    results = data.results ?? [];
  } catch (e) {
    error = e instanceof PspError ? e.message : 'Failed to load history';
  }

  // RTP requests the user is involved in: inbox (I am the payer → I approve/pay) and outbox (I am the
  // payee → I requested). Reuses the PSP RTP API. These are merged INTO the operations table below so
  // there is a single list: undecided approvals show inline buttons, decided ones show their status.
  let rtpDocs: Array<{ x: any; role: 'to_approve' | 'requested' }> = [];
  if (hasScope(session, 'read:rtp')) {
    try {
      const [inbox, outbox] = await Promise.all([
        c!.listRtpRequests('inbox').catch(() => ({ results: [] as any[] })),
        c!.listRtpRequests('outbox').catch(() => ({ results: [] as any[] })),
      ]);
      const seen = new Set<string>();
      for (const x of inbox.results ?? []) { const k = x.paymentRequestInstanceReference; if (!seen.has(k)) { seen.add(k); rtpDocs.push({ x, role: 'to_approve' }); } }
      for (const x of outbox.results ?? []) { const k = x.paymentRequestInstanceReference; if (!seen.has(k)) { seen.add(k); rtpDocs.push({ x, role: 'requested' }); } }
    } catch { /* ignore */ }
  }

  const rate = MERCHANT_COMMISSION_RATE;
  const toMs = (s?: string) => (s ? Date.parse(s) || 0 : 0);

  // Operation rows (SD-65 executions + card transactions), from the merged PSP history.
  const opRows = results.map((t, i) => {
    const gross = t.grossAmount ?? t.paymentExecutionAmount?.amount;
    const commission = typeof gross === 'number' ? gross * rate : undefined;
    return {
      key: (t.paymentExecutionInstanceReference ?? `op-${i}`) as string,
      txnId: (t.paymentExecutionInstanceReference ?? t.transferReference ?? '') as string,
      date: (t.completedAt ?? t.initiatedAt ?? '').toString().slice(0, 10) || 'n/a',
      concept: (t.concept ?? '') as string,
      direction: (t.direction ?? 'n/a') as string,
      amount: money(gross, t.currency),
      fee: money(t.feeAmount, t.currency),
      commission: commission != null ? money(commission, t.currency) : 'n/a',
      rail: (t.paymentExecutionRail ?? 'n/a') as string,
      status: (t.paymentExecutionStatus ?? t.status) as string,
      approveRef: undefined as string | undefined,
      sortAt: toMs(t.completedAt ?? t.initiatedAt),
    };
  });

  // Hide the SD-65 execution row when it is the settlement of an RTP shown here (BIAN keeps them as
  // separate records; we de-dup the presentation so the same movement is not listed twice).
  const linkedExecRefs = new Set(rtpDocs.map(({ x }) => x.linkedPaymentExecutionReference).filter(Boolean) as string[]);
  const opRowsDeduped = opRows.filter((r) => !linkedExecRefs.has(r.txnId));

  // RTP rows. Undecided + I am the payer → show approve/reject in the status cell. Money is OUTGOING
  // for the payer (I pay if I approve) and INCOMING for the payee (I requested it).
  const rtpRows = rtpDocs.map(({ x, role }) => {
    const decided = !RTP_PENDING.includes(x.status);
    const gross = typeof x.amount === 'number' ? x.amount : undefined;
    const commission = gross != null ? gross * rate : undefined;
    return {
      key: x.paymentRequestInstanceReference as string,
      txnId: x.paymentRequestInstanceReference as string,
      date: (x.recordCreatedDateTime ?? '').toString().slice(0, 10) || 'n/a',
      concept: (x.purpose ?? 'Payment request') as string,
      direction: role === 'to_approve' ? 'sent' : 'received',
      amount: money(gross, x.currency),
      fee: 'n/a',
      commission: commission != null ? money(commission, x.currency) : 'n/a',
      rail: 'rtp',
      status: x.status as string,
      approveRef: role === 'to_approve' && !decided ? (x.paymentRequestInstanceReference as string) : undefined,
      sortAt: toMs(x.recordCreatedDateTime),
    };
  });

  const rows = [...opRowsDeduped, ...rtpRows].sort((a, b) => b.sortAt - a.sortAt);

  const DirIcon = (d: string) => (/in|credit|received/i.test(d) ? ArrowDownLeft : ArrowUpRight);

  return (
    <div>
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <ReceiptText className="h-6 w-6 text-leaf-deep" aria-hidden /> Operation history
        <InfoHint label="Every payment and transfer made on your behalf, with status, fees and the merchant commission." />
      </h1>

      {error ? (
        <PspUnavailable message={error} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ReceiptText className="h-8 w-8" />} title="No operations yet" hint="Payments and transfers will show up here once you make one." />
      ) : (
        <>
          {/* Desktop / tablet: table */}
          <div className="glass hidden overflow-x-auto rounded-2xl md:block">
            <table className="w-full text-sm">
              <thead className="bg-surface-alt text-left text-muted">
                <tr>
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 font-medium">Transaction ID</th>
                  <th className="p-3 font-medium">Concept</th>
                  <th className="p-3 font-medium">Direction</th>
                  <th className="p-3 font-medium">Amount</th>
                  <th className="p-3 font-medium">Fee</th>
                  <th className="p-3 font-medium">Commission*</th>
                  <th className="p-3 font-medium">Rail</th>
                  <th className="p-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const Icon = DirIcon(r.direction);
                  return (
                    <tr key={r.key} className="border-t border-line text-ink">
                      <td className="p-3">{r.date}</td>
                      <td className="p-3">
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono text-xs text-muted" title={r.txnId || undefined}>{shortRef(r.txnId)}</span>
                          {r.txnId && <CopyButton value={r.txnId} label="transaction ID" />}
                        </span>
                      </td>
                      <td className="p-3 text-muted max-w-[14rem] truncate" title={r.concept || undefined}>{r.concept || 'n/a'}</td>
                      <td className="p-3"><span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5 text-muted" aria-hidden /> {r.direction}</span></td>
                      <td className="p-3 font-medium">{r.amount}</td>
                      <td className="p-3 text-muted">{r.fee}</td>
                      <td className="p-3 text-muted">{r.commission}</td>
                      <td className="p-3 uppercase">{r.rail}</td>
                      <td className="p-3">
                        {r.approveRef
                          ? <RtpActions reference={r.approveRef} mode="approve" />
                          : <Chip tone={statusTone(r.status)}>{statusLabel(r.status)}</Chip>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((r) => {
              const Icon = DirIcon(r.direction);
              return (
                <div key={r.key} className="glass rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                      <Icon className="h-4 w-4" aria-hidden /> {r.direction} · {r.date}
                    </span>
                    {r.approveRef
                      ? <RtpActions reference={r.approveRef} mode="approve" />
                      : <Chip tone={statusTone(r.status)}>{statusLabel(r.status)}</Chip>}
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-lg font-semibold text-ink">{r.amount}</span>
                    <span className="text-xs uppercase text-muted">{r.rail}</span>
                  </div>
                  <div className="mt-1 flex gap-4 text-xs text-muted">
                    <span>Fee {r.fee}</span>
                    <span>Commission {r.commission}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                    <span className="font-mono" title={r.txnId || undefined}>ID {shortRef(r.txnId)}</span>
                    {r.txnId && <CopyButton value={r.txnId} label="transaction ID" />}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-3 text-xs text-muted">
        * Commission shown for display, computed from the merchant rate ({(MERCHANT_COMMISSION_RATE * 100).toFixed(1)}%).
      </p>
    </div>
  );
}

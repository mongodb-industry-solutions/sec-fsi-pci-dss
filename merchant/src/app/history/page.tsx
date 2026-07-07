// History (C-17): the user's operations with status + applied commission.
import { redirect } from 'next/navigation';
import { ReceiptText, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { PspClient, PspError } from '@/lib/PspClient';
import { getSession, hasScope } from '@/lib/session';
import { ScopeMissing, PspUnavailable } from '@/components/ScopeGate';
import { Chip, EmptyState, InfoHint } from '@/components/ui/Bits';
import CopyButton from '@/components/ui/CopyButton';
import { MERCHANT_COMMISSION_RATE } from '@/config/products';

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
  try {
    const data = await c!.listHistory();
    results = data.results ?? [];
  } catch (e) {
    error = e instanceof PspError ? e.message : 'Failed to load history';
  }

  const rows = results.map((t, i) => {
    const gross = t.grossAmount ?? t.paymentExecutionAmount?.amount;
    const commission = typeof gross === 'number' ? gross * MERCHANT_COMMISSION_RATE : undefined;
    const status = t.paymentExecutionStatus ?? t.status;
    const txnId = t.paymentExecutionInstanceReference ?? t.transferReference ?? '';
    return {
      key: t.paymentExecutionInstanceReference ?? i,
      txnId,
      date: (t.completedAt ?? t.initiatedAt ?? '').toString().slice(0, 10) || 'n/a',
      concept: (t.concept ?? '') as string,
      direction: t.direction ?? 'n/a',
      amount: money(gross, t.currency),
      fee: money(t.feeAmount, t.currency),
      commission: commission != null ? money(commission, t.currency) : 'n/a',
      rail: t.paymentExecutionRail ?? 'n/a',
      status,
    };
  });

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
                      <td className="p-3"><Chip tone={statusTone(r.status)}>{r.status ?? 'n/a'}</Chip></td>
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
                    <Chip tone={statusTone(r.status)}>{r.status ?? 'n/a'}</Chip>
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

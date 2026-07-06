// History (C-17): the user's operations with status + applied commission.
import { redirect } from 'next/navigation';
import { PspClient, PspError } from '@/lib/PspClient';
import { getSession, hasScope } from '@/lib/session';
import { ScopeMissing, PspUnavailable } from '@/components/ScopeGate';
import { MERCHANT_COMMISSION_RATE } from '@/config/products';

function money(a?: { amount: number; currency: string } | number, currency?: string) {
  if (a == null) return '—';
  if (typeof a === 'number') return `${currency ?? ''} ${a.toFixed(2)}`.trim();
  return `${a.currency} ${a.amount.toFixed(2)}`;
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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Operation history</h1>
      {error ? (
        <PspUnavailable message={error} />
      ) : results.length === 0 ? (
        <p className="text-espresso-light">No operations yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-espresso/10 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-crema/50 text-left">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Direction</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Fee</th>
                <th className="p-3">Commission*</th>
                <th className="p-3">Rail</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((t, i) => {
                const gross = t.grossAmount ?? t.paymentExecutionAmount?.amount;
                const commission = typeof gross === 'number' ? (gross * MERCHANT_COMMISSION_RATE) : undefined;
                return (
                  <tr key={t.paymentExecutionInstanceReference ?? i} className="border-t border-espresso/10">
                    <td className="p-3">{(t.completedAt ?? t.initiatedAt ?? '').toString().slice(0, 10) || '—'}</td>
                    <td className="p-3">{t.direction ?? '—'}</td>
                    <td className="p-3">{money(gross, t.currency)}</td>
                    <td className="p-3">{money(t.feeAmount, t.currency)}</td>
                    <td className="p-3">{commission != null ? money(commission, t.currency) : '—'}</td>
                    <td className="p-3">{t.paymentExecutionRail ?? '—'}</td>
                    <td className="p-3">{t.paymentExecutionStatus ?? t.status ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-espresso-light">
        * Commission shown for display, computed from the merchant rate ({(MERCHANT_COMMISSION_RATE * 100).toFixed(1)}%).
      </p>
    </div>
  );
}

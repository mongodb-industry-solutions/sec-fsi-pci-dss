// v28 Request to Pay (merchant): two lists — requests awaiting the merchant's approval (payer view)
// and requests the merchant sent (payee view, with status). Approve/reject reuse the authenticated
// OAuth session (no CIBA). Server component, scope-gated (read:rtp for view, write:rtp for actions).
import { redirect } from 'next/navigation';
import { HandCoins } from 'lucide-react';
import { PspClient, PspError } from '@/lib/PspClient';
import { getSession, hasScope } from '@/lib/session';
import { ScopeMissing, PspUnavailable } from '@/components/ScopeGate';
import { EmptyState } from '@/components/ui/Bits';
import RtpActions from './RtpActions';

export default async function RequestToPayPage() {
  const session = await getSession();
  if (!session) redirect('/');
  if (!hasScope(session, 'read:rtp')) return <ScopeMissing scope="read:rtp" />;
  const canWrite = hasScope(session, 'write:rtp');

  const c = await PspClient.fromSession();
  let inbox: Array<Record<string, unknown>> = [];
  let outbox: Array<Record<string, unknown>> = [];
  let error: string | undefined;
  try {
    inbox = (await c!.listRtpRequests('inbox')).results ?? [];
    outbox = (await c!.listRtpRequests('outbox')).results ?? [];
  } catch (e) {
    error = e instanceof PspError ? e.message : 'Failed to load requests';
  }

  const pending = inbox.filter((r) => ['presented', 'delivered', 'viewed'].includes(String(r.status)));

  return (
    <div>
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <HandCoins className="h-6 w-6 text-leaf-deep" aria-hidden /> Request to Pay
      </h1>

      {error ? <PspUnavailable message={error} /> : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold">Requests awaiting your approval</h2>
            {pending.length === 0 ? (
              <EmptyState icon={<HandCoins className="h-8 w-8" />} title="Nothing to approve" hint="Requests you need to approve appear here." />
            ) : (
              <div className="space-y-2">
                {pending.map((r) => (
                  <div key={String(r.paymentRequestInstanceReference)} className="glass flex items-center gap-3 rounded-2xl p-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink truncate">{String(r.payeeName ?? 'A payee')} · {String(r.amount)} {String(r.currency)}</p>
                      <p className="text-xs text-slate-500 truncate">{String(r.purpose ?? 'Payment request')} · {String(r.status)}</p>
                    </div>
                    {canWrite && <RtpActions reference={String(r.paymentRequestInstanceReference)} mode="approve" />}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Requests you sent</h2>
            {outbox.length === 0 ? (
              <EmptyState icon={<HandCoins className="h-8 w-8" />} title="No sent requests" hint="Money you request from others appears here." />
            ) : (
              <div className="space-y-2">
                {outbox.map((r) => (
                  <div key={String(r.paymentRequestInstanceReference)} className="glass flex items-center gap-3 rounded-2xl p-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink truncate">{String(r.amount)} {String(r.currency)} · {String(r.purpose ?? 'Payment request')}</p>
                      <p className="text-xs text-slate-500 truncate">Status: {String(r.status)}</p>
                    </div>
                    {canWrite && ['created', 'presented', 'delivered', 'viewed'].includes(String(r.status)) && (
                      <RtpActions reference={String(r.paymentRequestInstanceReference)} mode="cancel" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

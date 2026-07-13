// Beneficiaries (C-14): list the user's saved beneficiaries (masked) + link to direct pay.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Users, Send } from 'lucide-react';
import { PspClient, PspError } from '@/lib/PspClient';
import { getSession, hasScope } from '@/lib/session';
import { ScopeMissing, PspUnavailable } from '@/components/ScopeGate';
import { EmptyState, InfoHint } from '@/components/ui/Bits';
import { Tip } from '@/components/ui/Tooltip';
import { loadAccountOptions } from '@/lib/accounts';
import BeneficiarySend from './BeneficiarySend';
import BeneficiaryAdd from './BeneficiaryAdd';

export default async function BeneficiariesPage() {
  const session = await getSession();
  if (!session) redirect('/');
  if (!hasScope(session, 'read:beneficiaries')) return <ScopeMissing scope="read:beneficiaries" />;

  const c = await PspClient.fromSession();
  let results: any[] = [];
  let error: string | undefined;
  try {
    const data = await c!.listBeneficiaries();
    results = data.results ?? [];
  } catch (e) {
    error = e instanceof PspError ? e.message : 'Failed to load beneficiaries';
  }

  // Fetch the user's source accounts once (server-side) so each row's send control can offer a
  // source picker without fetching per row. Empty when the scope is missing or on error.
  const accounts = await loadAccountOptions();

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Users className="h-6 w-6 text-leaf-deep" aria-hidden /> Beneficiaries
          <InfoHint label="People and accounts you can pay. Identifiers are masked, so the merchant never sees them in clear." />
        </h1>
        {/* Primary actions aligned on one row. */}
        <div className="flex items-center gap-2">
          {hasScope(session, 'write:beneficiaries') && <BeneficiaryAdd />}
          {hasScope(session, 'write:transfers') && (
            <Tip label="Send a bank transfer to a beneficiary.">
              <Link href="/transfers" className="btn-primary text-sm">
                <Send className="h-4 w-4" aria-hidden /> Send money
              </Link>
            </Tip>
          )}
        </div>
      </div>

      {error ? (
        <PspUnavailable message={error} />
      ) : results.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8" />} title="No saved beneficiaries yet" hint="Payees you add in Leafy Pay will appear here." />
      ) : (
        <ul className="glass divide-y divide-line/60 overflow-hidden rounded-2xl">
          {results.map((b, i) => (
            <li key={b.counterpartyArrangementReference ?? b.beneficiaryToken ?? i} className="flex items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-leaf/10 text-leaf-deep ring-1 ring-leaf/20">
                  <Users className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{b.counterpartyLabel ?? b.counterpartyName ?? b.label ?? 'Beneficiary'}</div>
                  <div className="truncate font-mono text-sm text-muted">
                    {b.counterpartyLookupHint ?? b.maskedContact ?? b.counterpartyMaskedIdentifier ?? '••••'}
                  </div>
                </div>
              </div>
              {hasScope(session, 'write:transfers') && (b.counterpartyArrangementReference ?? b.beneficiaryToken) && (
                <BeneficiarySend beneficiaryToken={b.counterpartyArrangementReference ?? b.beneficiaryToken} accounts={accounts} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

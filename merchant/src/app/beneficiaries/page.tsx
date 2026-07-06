// Beneficiaries (C-14): list the user's saved beneficiaries (masked) + link to direct pay.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PspClient, PspError } from '@/lib/PspClient';
import { getSession, hasScope } from '@/lib/session';
import { ScopeMissing, PspUnavailable } from '@/components/ScopeGate';

export default async function BeneficiariesPage() {
  const session = await getSession();
  if (!session) redirect('/');
  if (!hasScope(session, 'beneficiary:read')) return <ScopeMissing scope="beneficiary:read" />;

  const c = await PspClient.fromSession();
  let results: any[] = [];
  let error: string | undefined;
  try {
    const data = await c!.listBeneficiaries();
    results = data.results ?? [];
  } catch (e) {
    error = e instanceof PspError ? e.message : 'Failed to load beneficiaries';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Beneficiaries</h1>
        {hasScope(session, 'beneficiary:manage') && (
          <Link href="/transfers" className="rounded bg-espresso text-crema px-4 py-2 text-sm">Send money</Link>
        )}
      </div>

      {error ? (
        <PspUnavailable message={error} />
      ) : results.length === 0 ? (
        <p className="text-espresso-light">No saved beneficiaries yet.</p>
      ) : (
        <ul className="divide-y divide-espresso/10 rounded-xl border border-espresso/10 bg-white">
          {results.map((b, i) => (
            <li key={b.counterpartyArrangementReference ?? b.beneficiaryToken ?? i} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">{b.counterpartyName ?? b.label ?? b.beneficiaryLabel ?? 'Beneficiary'}</div>
                <div className="text-sm text-espresso-light font-mono">
                  {b.maskedContact ?? b.beneficiaryMaskedHint ?? b.counterpartyMaskedIdentifier ?? '••••'}
                </div>
              </div>
              {hasScope(session, 'beneficiary:manage') && (
                <Link href="/transfers" className="text-sm text-blue-700 underline">Pay</Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

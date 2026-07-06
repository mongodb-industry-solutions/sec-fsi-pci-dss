// Accounts (C-16): the user's payout accounts — masked IBAN only (GDPR/PSD2), default flagged.
import { redirect } from 'next/navigation';
import { PspClient, PspError } from '@/lib/PspClient';
import { getSession, hasScope } from '@/lib/session';
import { ScopeMissing, PspUnavailable } from '@/components/ScopeGate';

export default async function AccountsPage() {
  const session = await getSession();
  if (!session) redirect('/');
  if (!hasScope(session, 'balance:read')) return <ScopeMissing scope="balance:read" />;

  const c = await PspClient.fromSession();
  let results: any[] = [];
  let error: string | undefined;
  try {
    const data = await c!.listAccounts();
    results = data.results ?? [];
  } catch (e) {
    error = e instanceof PspError ? e.message : 'Failed to load accounts';
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Your accounts</h1>
      {error ? (
        <PspUnavailable message={error} />
      ) : results.length === 0 ? (
        <p className="text-espresso-light">No accounts found.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {results.map((a, i) => (
            <div key={a.payoutAccountInstanceReference ?? i} className="rounded-xl border border-espresso/10 bg-white p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{a.payoutAccountAlias ?? a.payoutAccountBankName ?? 'Account'}</h3>
                {a.payoutAccountIsDefault && <span className="rounded-full bg-crema px-2 py-0.5 text-xs">Default</span>}
              </div>
              <dl className="mt-2 text-sm text-espresso-light space-y-0.5">
                <div className="flex justify-between"><dt>Type</dt><dd>{a.payoutAccountType}</dd></div>
                <div className="flex justify-between"><dt>Currency</dt><dd>{a.payoutAccountCurrency}</dd></div>
                <div className="flex justify-between"><dt>Country</dt><dd>{a.payoutAccountCountryCode}</dd></div>
                <div className="flex justify-between"><dt>Rail</dt><dd>{a.payoutAccountPreferredRail}</dd></div>
                <div className="flex justify-between"><dt>IBAN</dt><dd className="font-mono">{a.payoutAccountMaskedIban ?? (a.payoutAccountHasIban ? '•••• (masked)' : '—')}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-espresso-light">IBANs are always shown masked — the merchant never receives them in clear.</p>
    </div>
  );
}

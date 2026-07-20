// Accounts (C-16): the user's payout accounts — masked IBAN only (GDPR/PSD2), default flagged.
import { redirect } from 'next/navigation';
import { Wallet, Landmark, Lock } from 'lucide-react';
import { PspClient, PspError } from '@/lib/PspClient';
import { getSession, hasScope } from '@/lib/session';
import { ScopeMissing, PspUnavailable } from '@/components/ScopeGate';
import { Chip, EmptyState, InfoHint } from '@/components/ui/Bits';

export default async function AccountsPage() {
  const session = await getSession();
  if (!session) redirect('/');
  if (!hasScope(session, 'read:accounts')) return <ScopeMissing scope="read:accounts" />;

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
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <Wallet className="h-6 w-6 text-leaf-deep" aria-hidden /> Your accounts
        <InfoHint label="Payout accounts held at Sec4 Pay. IBANs are always masked, so the merchant never receives them in clear (GDPR / PSD2)." />
      </h1>

      {error ? (
        <PspUnavailable message={error} />
      ) : results.length === 0 ? (
        <EmptyState icon={<Wallet className="h-8 w-8" />} title="No accounts found" hint="Payout accounts you add in Sec4 Pay will appear here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {results.map((a, i) => (
            <div key={a.payoutAccountInstanceReference ?? i} className="glass rounded-2xl p-5 transition duration-200 hover:-translate-y-0.5 hover:border-leaf/40">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-semibold text-ink">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-leaf/10 text-leaf-deep ring-1 ring-leaf/20">
                    <Landmark className="h-4 w-4" aria-hidden />
                  </span>
                  {a.payoutAccountAlias ?? a.payoutAccountBankName ?? 'Account'}
                </h3>
                {a.payoutAccountIsDefault && <Chip tone="accent">Default</Chip>}
              </div>
              {(() => {
                // PSP internal ledger balance (SD-66): available now vs pending settlement.
                const bal = a.payoutAccountBalance as
                  | { availableAmount?: number; pendingAmount?: number; currency?: string }
                  | undefined;
                if (!bal) return null;
                const cur = bal.currency ?? a.payoutAccountCurrency ?? 'EUR';
                const fmt = (n: number) => {
                  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n); }
                  catch { return `${n.toFixed(2)} ${cur}`; }
                };
                return (
                  <div className="mt-3 rounded-xl bg-leaf/5 p-3 ring-1 ring-leaf/15">
                    <div className="text-xs text-muted">Available balance</div>
                    <div className="text-xl font-semibold text-ink">{fmt(bal.availableAmount ?? 0)}</div>
                    {(bal.pendingAmount ?? 0) > 0 && (
                      <div className="mt-0.5 text-xs text-muted">{fmt(bal.pendingAmount ?? 0)} pending settlement</div>
                    )}
                  </div>
                );
              })()}
              <dl className="mt-3 space-y-1 text-sm text-muted">
                <div className="flex justify-between"><dt>Type</dt><dd className="text-ink">{a.payoutAccountType ?? 'n/a'}</dd></div>
                <div className="flex justify-between"><dt>Currency</dt><dd className="text-ink">{a.payoutAccountCurrency ?? 'n/a'}</dd></div>
                <div className="flex justify-between"><dt>Country</dt><dd className="text-ink">{a.payoutAccountCountryCode ?? 'n/a'}</dd></div>
                <div className="flex justify-between"><dt>Rail</dt><dd className="text-ink">{a.payoutAccountPreferredRail ?? 'n/a'}</dd></div>
                <div className="flex justify-between">
                  <dt>IBAN</dt>
                  <dd className="font-mono text-ink">{a.payoutAccountMaskedIban ?? (a.payoutAccountHasIban ? '•••• (masked)' : 'n/a')}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
        <Lock className="h-3.5 w-3.5" aria-hidden /> IBANs are always shown masked, so the merchant never receives them in clear.
      </p>
    </div>
  );
}

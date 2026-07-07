// Transfers (C-15): preview → execute a bank transfer (ACH / SEPA / SWIFT).
import { redirect } from 'next/navigation';
import { Send } from 'lucide-react';
import { getSession, hasScope } from '@/lib/session';
import { ScopeMissing } from '@/components/ScopeGate';
import { InfoHint } from '@/components/ui/Bits';
import { loadAccountOptions } from '@/lib/accounts';
import TransferForm from './TransferForm';

export default async function TransfersPage() {
  const session = await getSession();
  if (!session) redirect('/');
  if (!hasScope(session, 'write:transfers')) return <ScopeMissing scope="write:transfers" />;

  // Source-account options fetched server-side (masked IBAN only). Empty when read:accounts is absent.
  const accounts = await loadAccountOptions();

  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <Send className="h-6 w-6 text-leaf-deep" aria-hidden /> Bank transfer
        <InfoHint label="Espresso Works asks Leafy Pay to move money on your behalf. The PSP holds all balances; the merchant never does." />
      </h1>
      <p className="mb-6 mt-1 text-sm text-muted">Preview fees and rail, then submit. The PSP holds all balances.</p>
      <TransferForm accounts={accounts} />
    </div>
  );
}

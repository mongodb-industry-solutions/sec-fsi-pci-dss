// Transfers (C-15): preview → execute a bank transfer (ACH / SEPA / SWIFT).
import { redirect } from 'next/navigation';
import { getSession, hasScope } from '@/lib/session';
import { ScopeMissing } from '@/components/ScopeGate';
import TransferForm from './TransferForm';

export default async function TransfersPage() {
  const session = await getSession();
  if (!session) redirect('/');
  if (!hasScope(session, 'write:transfers')) return <ScopeMissing scope="write:transfers" />;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Bank transfer</h1>
      <p className="text-sm text-espresso-light mb-6">Preview fees and rail, then submit. The PSP holds all balances.</p>
      <TransferForm />
    </div>
  );
}

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageTitle } from '../../../components/Tiles';
import { AccountCreate } from '../../../components/accounts/AccountCreate';

export const metadata = { title: 'Open an account' };

export default function NewAccountPage() {
  return (
    <div className="space-y-6">
      <Link href="/accounts" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowLeft size={14} aria-hidden /> Accounts
      </Link>

      <PageTitle
        title="Open an account"
        description="The bank builds the IBAN from a bank code it has declared, with a check digit, so the account routes back to it. It opens waiting for approval and holds nothing until an operator accepts it."
      />

      <AccountCreate />
    </div>
  );
}

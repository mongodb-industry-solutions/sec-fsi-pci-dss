import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageTitle } from '../../components/Tiles';
import { AccountsList } from '../../components/accounts/AccountsList';

export const metadata = { title: 'Accounts' };

export default function AccountsPage() {
  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowLeft size={14} aria-hidden /> Administration
      </Link>

      <PageTitle
        title="Accounts"
        description="Every account this bank holds. The IBAN and the holder's name are encrypted, so a row carries the masked form of each: a list of two hundred accounts decrypts nothing, and the full value is read one account at a time."
      />

      <Suspense fallback={<p className="text-sm text-ink-soft">Reading the accounts…</p>}>
        <AccountsList />
      </Suspense>
    </div>
  );
}

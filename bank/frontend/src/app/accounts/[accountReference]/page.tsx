import { Suspense } from 'react';
import { AccountDetail } from '../../../components/accounts/AccountDetail';

export const metadata = { title: 'Account' };

// One account, with its owner and the cards that draw on it. The embedded card list reads the URL, so the
// boundary is needed here too.
export default async function AccountPage({ params }: { params: Promise<{ accountReference: string }> }) {
  const { accountReference } = await params;
  return (
    <Suspense fallback={<p className="py-8 text-sm text-ink-soft">Reading the account…</p>}>
      <AccountDetail accountReference={decodeURIComponent(accountReference)} />
    </Suspense>
  );
}

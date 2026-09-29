import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageTitle } from '../../components/Tiles';
import { HoldersList } from '../../components/holders/HoldersList';

export const metadata = { title: 'Parties' };

export default function HoldersPage() {
  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowLeft size={14} aria-hidden /> Administration
      </Link>

      <PageTitle
        title="Parties"
        description="The customers this bank holds accounts for. Not the provider's users: an account belongs to the bank and a user belongs to the provider, and the two are linked by a consent rather than by a shared identity."
      />

      <Suspense fallback={<p className="text-sm text-ink-soft">Reading the parties…</p>}>
        <HoldersList />
      </Suspense>
    </div>
  );
}

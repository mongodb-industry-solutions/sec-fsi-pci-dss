import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageTitle } from '../../components/Tiles';
import { CardsList } from '../../components/cards/CardsList';

export const metadata = { title: 'Card estate' };

// The card estate, on its own URL.
//
// It was a tab behind the issuer's rules page before, which made it unlinkable: an operator could not send a
// colleague the list of suspended cards, and the browser's back button left the wrong panel showing. The rules
// and the estate are two jobs, so they are two addresses.

export default function CardsPage() {
  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowLeft size={14} aria-hidden /> Administration
      </Link>

      <PageTitle
        title="Card estate"
        description="Every card this bank issued. No card number appears in a list: the number lives encrypted in the vault and is read one card at a time, so opening this page decrypts nothing."
      />

      {/* The list reads the filters from the URL, so it needs a boundary while those resolve. */}
      <Suspense fallback={<p className="text-sm text-ink-soft">Reading the estate…</p>}>
        <CardsList />
      </Suspense>
    </div>
  );
}

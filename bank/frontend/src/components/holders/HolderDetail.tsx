'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CreditCard, Landmark, User } from 'lucide-react';
import { admin, AdminError } from '../../lib/adminClient';
import { Field, Panel, Reveal } from '../Reveal';
import { StatusBadge } from '../data/StatusBadge';
import { BankError } from '../States';
import { AccountsList } from '../accounts/AccountsList';
import { CardsList } from '../cards/CardsList';

// The party behind the accounts and the cards.
//
// This is the third corner of the triangle: a card names an owner and an account, an account names an owner, and
// from here both directions are reachable. Without it an operator holding a holder reference from a card would
// have no screen to take it to.
//
// The name and the contact are the bank's own personal data about a customer, encrypted at rest and revealed one
// party at a time. Note that this is NOT the provider's user: the account belongs to the bank, the user belongs
// to the provider, and the two are linked by consent rather than by a shared identity.

interface Holder {
  accountHolderInstanceReference: string;
  accountHolderNameMasked: string;
  accountHolderEmailMasked?: string;
  accountHolderCountryCode: string;
  accountHolderStatus: string;
  accountCount: number;
}

export function HolderDetail({ holderReference }: { holderReference: string }) {
  const [holder, setHolder] = useState<Holder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    admin.read<Holder>(`holders/${encodeURIComponent(holderReference)}`)
      .then((record) => { if (live) { setHolder(record); setError(null); } })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof AdminError ? cause.message : String(cause));
      });
    return () => { live = false; };
  }, [holderReference]);

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <BankError message={error} />
      </div>
    );
  }
  if (!holder) return <div className="py-8 text-sm text-ink-soft">Reading the party…</div>;

  const disclose = () => admin.disclose<{ accountHolderName?: string; accountHolderEmailAddress?: string }>(
    `holders/${encodeURIComponent(holderReference)}/disclosures`,
  );

  return (
    <div className="space-y-4">
      <BackLink />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <User size={18} className="shrink-0 text-accent" aria-hidden />
          <h1 className="truncate text-lg font-semibold sm:text-xl">{holder.accountHolderNameMasked}</h1>
          <StatusBadge status={holder.accountHolderStatus} />
        </div>
        <p className="mt-1 text-pretty text-xs leading-relaxed text-ink-soft">
          A party this bank holds accounts for. The masked name is what every list shows: it is enough to
          recognise a record you already know, and not enough to learn one you do not.
        </p>
      </div>

      <Panel
        title="Protected values"
        description="Personal data the bank holds about its customer, encrypted at rest. Each reveal is its own recorded act."
      >
        <Reveal
          label="Name"
          masked={holder.accountHolderNameMasked}
          fetchValue={async () => (await disclose()).accountHolderName ?? 'not held'}
        />
        <Reveal
          label="Contact"
          masked={holder.accountHolderEmailMasked}
          fetchValue={async () => (await disclose()).accountHolderEmailAddress ?? 'not held'}
        />
        <Field label="Country">{holder.accountHolderCountryCode}</Field>
        <Field label="Reference" mono>{holder.accountHolderInstanceReference}</Field>
      </Panel>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Landmark size={16} className="text-accent" aria-hidden />
          <h2 className="text-sm font-semibold">Accounts</h2>
        </div>
        <AccountsList
          fixed={{ holder: holderReference }}
          toolbar={(
            <Link
              href="/accounts/new"
              className="inline-flex h-11 shrink-0 items-center rounded-lg border border-line px-3 text-sm text-ink-soft transition hover:border-accent hover:text-ink sm:h-9"
            >
              Open another
            </Link>
          )}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard size={16} className="text-accent" aria-hidden />
          <h2 className="text-sm font-semibold">Cards</h2>
        </div>
        <CardsList
          fixed={{ holder: holderReference }}
          heading={<span className="sr-only">This party&apos;s cards</span>}
        />
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/holders" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
      <ArrowLeft size={14} aria-hidden /> Parties
    </Link>
  );
}

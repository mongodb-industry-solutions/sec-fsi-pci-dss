'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CreditCard, Landmark, User } from 'lucide-react';
import { admin, AdminError } from '../../lib/adminClient';
import { Field, Panel, Reveal } from '../Reveal';
import { Action } from '../ui/Action';
import { StatusBadge } from '../data/StatusBadge';
import { BankError } from '../States';
import { JsonView } from '../JsonView';
import { CardLimits } from './CardLimits';
import type { CardRow } from './CardsList';

// One card, everything about it, and the two records it belongs to.
//
// A card is never a thing on its own: it has an OWNER and it draws on an ACCOUNT. An operator who arrives here
// from a fraud alert needs both within one click, and a screen that shows a token with no way to reach either
// forces them back to a list to search for it by hand.
//
// The protected values are fetched only when the eye is clicked, and each click is a separate disclosure the
// bank records. So this page can be left open on a desk without a card number sitting in the browser.

interface Disclosure {
  cardNumber?: string;
  verificationValue?: string;
  expiry?: string;
  serviceCode?: string;
  error?: string;
}

interface Holder {
  accountHolderInstanceReference: string;
  accountHolderNameMasked: string;
  accountHolderEmailMasked?: string;
  accountHolderCountryCode: string;
  accountHolderStatus: string;
}

const NEXT_STATUS: Record<string, { label: string; to: string; tone: 'primary' | 'normal'; why: string }[]> = {
  issued: [
    { label: 'Activate', to: 'active', tone: 'primary', why: 'The holder has received it and it may now be used.' },
  ],
  active: [
    { label: 'Suspend', to: 'suspended', tone: 'normal', why: 'Stops authorisations without ending the card.' },
  ],
  suspended: [
    { label: 'Reinstate', to: 'active', tone: 'primary', why: 'Authorisations resume.' },
  ],
  revoked: [],
};

export function CardDetail({ cardToken }: { cardToken: string }) {
  const [card, setCard] = useState<CardRow | null>(null);
  const [holder, setHolder] = useState<Holder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    let live = true;
    admin.read<CardRow>(`cards/${encodeURIComponent(cardToken)}`)
      .then((record) => { if (live) { setCard(record); setError(null); } })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof AdminError ? cause.message : String(cause));
      });
    return () => { live = false; };
  }, [cardToken, reloads]);

  // The owner is read separately and MASKED. Fetched here rather than joined at the bank because the holder
  // record is encrypted, so there is no join to make: two reads is the shape the storage allows.
  useEffect(() => {
    const reference = card?.holderReference;
    if (!reference) return undefined;
    let live = true;
    admin.read<Holder>(`holders/${encodeURIComponent(reference)}`)
      .then((record) => { if (live) setHolder(record); })
      .catch(() => { if (live) setHolder(null); });
    return () => { live = false; };
  }, [card?.holderReference]);

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <BankError message={error} />
      </div>
    );
  }
  if (!card) return <div className="py-8 text-sm text-ink-soft">Reading the card…</div>;

  const terminal = card.status === 'revoked';
  const disclose = () => admin.disclose<Disclosure>(`cards/${encodeURIComponent(cardToken)}/disclosures`);

  return (
    <div className="space-y-4">
      <BackLink />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CreditCard size={18} className="shrink-0 text-accent" aria-hidden />
            <h1 className="truncate font-mono text-lg font-semibold sm:text-xl">
              {card.maskedDisplay || `•••• ${card.lastFour}`}
            </h1>
            <StatusBadge status={card.status} />
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            {card.network} {card.kind} card, issued by this bank.
            {terminal && ' It is revoked, which is terminal: the record stays for the audit trail and the card cannot be used again.'}
          </p>
        </div>
      </div>

      {/* ── The protected values ───────────────────────────────────────────────────────────────── */}
      <Panel
        title="Protected values"
        description="Encrypted at rest, and read one card at a time. Each reveal is a separate act the bank records against whoever asked."
      >
        <Reveal
          label="Card number"
          masked={card.maskedDisplay}
          fetchValue={async () => {
            const result = await disclose();
            return result.cardNumber ?? result.error ?? 'not held';
          }}
        />
        <Reveal
          label="Verification value"
          fetchValue={async () => {
            const result = await disclose();
            // Said plainly when it cannot be produced: a blank looks the same as a card that has none, and
            // those are different problems.
            return result.verificationValue ?? result.error ?? 'not derivable';
          }}
          hint="derived, never stored"
        />
        <Field label="Expires" mono>
          {card.expiryMonth ? `${card.expiryMonth}/${card.expiryYear}` : ''}
        </Field>
        <Field label="Token" mono>{card.cardToken}</Field>
        <Field label="Range">{card.bin}</Field>
      </Panel>

      {/* ── Who it belongs to, and what it draws on ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Owner"
          description="The party this card was issued to. The name is encrypted, so it arrives masked."
          actions={card.holderReference ? (
            <Link
              href={`/holders/${encodeURIComponent(String(card.holderReference))}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink-soft transition hover:border-accent hover:text-ink"
            >
              <User size={14} aria-hidden /> Open the owner
            </Link>
          ) : undefined}
        >
          {card.holderReference ? (
            <>
              <Field label="Name">{holder?.accountHolderNameMasked ?? '••••'}</Field>
              <Field label="Contact">{holder?.accountHolderEmailMasked ?? '••••'}</Field>
              <Field label="Country">{holder?.accountHolderCountryCode}</Field>
              <Field label="Reference" mono>{String(card.holderReference)}</Field>
            </>
          ) : (
            <p className="text-xs text-ink-soft">
              This card carries no holder reference, which means it was minted for a test rather than issued to
              a party.
            </p>
          )}
        </Panel>

        <Panel
          title="Funding account"
          description="Every card here is a debit card, so an authorisation is a hold against this account's balance."
          actions={card.fundingAccountReference ? (
            <Link
              href={`/accounts/${encodeURIComponent(String(card.fundingAccountReference))}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink-soft transition hover:border-accent hover:text-ink"
            >
              <Landmark size={14} aria-hidden /> Open the account
            </Link>
          ) : undefined}
        >
          {card.fundingAccountReference ? (
            <Field label="Reference" mono>{String(card.fundingAccountReference)}</Field>
          ) : (
            <p className="text-xs text-ink-soft">
              No funding account is linked, so an authorisation on this card is judged on its limits alone with
              no balance to hold against.
            </p>
          )}
        </Panel>
      </div>

      {/* ── Lifecycle ─────────────────────────────────────────────────────────────────────────── */}
      <Panel
        title="Lifecycle"
        description="Only legal moves are offered. Revoking is terminal, which is why it asks first."
      >
        <div className="flex flex-wrap gap-2">
          {(NEXT_STATUS[card.status] ?? []).map((move) => (
            <Action
              key={move.to}
              label={move.label}
              tone={move.tone}
              title={move.why}
              run={() => admin.put(`cards/${encodeURIComponent(cardToken)}/status`, { status: move.to })}
              onDone={reload}
            />
          ))}
          {!terminal && (
            <>
              <Action
                label="Replace"
                title="Issues a new card with its own number, then revokes this one."
                confirm="A replacement is issued first and this card is then revoked. The old number stops working."
                run={() => admin.create(`cards/${encodeURIComponent(cardToken)}/replacements`, {})}
                onDone={reload}
              />
              <Action
                label="Revoke"
                tone="danger"
                confirm="This card can never be used again. The record is kept, because an authorisation already made refers to it."
                run={() => admin.remove(`cards/${encodeURIComponent(cardToken)}`)}
                onDone={reload}
              />
            </>
          )}
          {terminal && (
            <p className="text-xs text-ink-soft">
              A revoked card offers no action. Issue a replacement from the estate instead.
            </p>
          )}
        </div>
      </Panel>

      {/* ── The ceiling an authorisation is judged against ─────────────────────────────────────── */}
      {!terminal && (
        <Panel
          title="Limits"
          description="What this card may authorise in one transaction. Read per call, so a change applies to the next authorisation."
        >
          <CardLimits cardToken={cardToken} initial={card.limits} onSaved={reload} />
        </Panel>
      )}

      <Panel title="The record as the bank holds it" description="What the registry stores, with no decrypted value in it.">
        <JsonView data={card} title="Card record" collapsed={1} />
      </Panel>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/cards" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
      <ArrowLeft size={14} aria-hidden /> Card estate
    </Link>
  );
}

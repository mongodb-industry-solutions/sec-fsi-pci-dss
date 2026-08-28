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
import { CardsList } from '../cards/CardsList';
import type { AccountRow } from './AccountsList';

// One account: what it holds, who owns it, and which cards draw on it.
//
// The three are one screen because they are one question. An operator looking at a suspicious balance needs to
// know whose account it is and what can spend from it, and splitting that across three searches is how a review
// takes twenty minutes instead of one.
//
// The IBAN and the owner's name are both encrypted, so both are revealed on demand rather than rendered. Note
// which regime each falls under: an IBAN is personal data, not cardholder data, so it is protected because the
// privacy rules require it rather than because the card rules do.

interface Holder {
  accountHolderInstanceReference: string;
  accountHolderNameMasked: string;
  accountHolderEmailMasked?: string;
  accountHolderCountryCode: string;
  accountHolderStatus: string;
  accountCount: number;
}

const NEXT_STATUS: Record<string, { label: string; to: string; tone: 'primary' | 'normal'; why: string }[]> = {
  pending_approval: [
    { label: 'Approve', to: 'active', tone: 'primary', why: 'Accepts the account into use. Until then it can hold nothing.' },
  ],
  active: [
    { label: 'Block', to: 'blocked', tone: 'normal', why: 'Stops movement without ending the relationship.' },
  ],
  blocked: [
    { label: 'Unblock', to: 'active', tone: 'primary', why: 'Movement resumes.' },
  ],
  closed: [],
};

export function AccountDetail({ accountReference }: { accountReference: string }) {
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [holder, setHolder] = useState<Holder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    let live = true;
    admin.read<AccountRow>(`accounts/${encodeURIComponent(accountReference)}`)
      .then((record) => { if (live) { setAccount(record); setError(null); } })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof AdminError ? cause.message : String(cause));
      });
    return () => { live = false; };
  }, [accountReference, reloads]);

  useEffect(() => {
    const reference = account?.accountHolderInstanceReference;
    if (!reference) return undefined;
    let live = true;
    admin.read<Holder>(`holders/${encodeURIComponent(reference)}`)
      .then((record) => { if (live) setHolder(record); })
      .catch(() => { if (live) setHolder(null); });
    return () => { live = false; };
  }, [account?.accountHolderInstanceReference]);

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <BankError message={error} />
      </div>
    );
  }
  if (!account) return <div className="py-8 text-sm text-ink-soft">Reading the account…</div>;

  const closed = account.accountStatus === 'closed';
  const holdsFunds = (account.availableAmount ?? 0) !== 0;

  return (
    <div className="space-y-4">
      <BackLink />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Landmark size={18} className="shrink-0 text-accent" aria-hidden />
          <h1 className="truncate font-mono text-lg font-semibold sm:text-xl">{account.accountMaskedIban}</h1>
          <StatusBadge status={account.accountStatus} />
        </div>
        <p className="mt-1 text-pretty text-xs leading-relaxed text-ink-soft">
          {account.accountKind} account in {account.accountCurrency}, held at this bank.
          {closed && ' It is closed, which is terminal: the record stays because settled payments refer to it.'}
        </p>
      </div>

      {/* ── The balance ────────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure
          label="Available"
          value={`${(account.availableAmount ?? 0).toFixed(2)} ${account.accountCurrency}`}
        />
        <Figure
          label="Held"
          value={`${(account.reservedAmount ?? 0).toFixed(2)} ${account.accountCurrency}`}
          hint="Reserved by an authorisation that has not settled yet."
        />
        <Figure
          label="Owner's accounts"
          value={holder ? String(holder.accountCount) : '…'}
          hint="How many accounts this party holds at the bank."
        />
      </div>

      {/* ── The protected values ───────────────────────────────────────────────────────────────── */}
      <Panel
        title="Protected values"
        description="The IBAN is personal data and is encrypted at rest, so it is read one account at a time and each read is recorded."
      >
        <Reveal
          label="IBAN"
          masked={account.accountMaskedIban}
          fetchValue={async () => {
            const result = await admin.disclose<{ iban?: string }>(
              `accounts/${encodeURIComponent(accountReference)}/disclosures`,
            );
            return result.iban ?? 'not held';
          }}
        />
        <Field label="Bank identifier" mono>{account.accountBic}</Field>
        <Field label="Alias">{account.accountAlias ?? ''}</Field>
        <Field label="Reference" mono>{account.accountArrangementInstanceReference}</Field>
      </Panel>

      {/* ── The owner ──────────────────────────────────────────────────────────────────────────── */}
      <Panel
        title="Owner"
        description="The party this account belongs to. The name and contact are encrypted, so both arrive masked."
        actions={(
          <Link
            href={`/holders/${encodeURIComponent(account.accountHolderInstanceReference)}`}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink-soft transition hover:border-accent hover:text-ink"
          >
            <User size={14} aria-hidden /> Open the owner
          </Link>
        )}
      >
        <Field label="Name">{holder?.accountHolderNameMasked ?? '••••'}</Field>
        <Field label="Contact">{holder?.accountHolderEmailMasked ?? '••••'}</Field>
        <Field label="Country">{holder?.accountHolderCountryCode ?? ''}</Field>
        <Field label="Reference" mono>{account.accountHolderInstanceReference}</Field>
      </Panel>

      {/* ── Lifecycle ─────────────────────────────────────────────────────────────────────────── */}
      <Panel
        title="Lifecycle"
        description="Approving an account is a real step: until it happens the account exists and holds nothing."
      >
        <div className="flex flex-wrap gap-2">
          {(NEXT_STATUS[account.accountStatus] ?? []).map((move) => (
            <Action
              key={move.to}
              label={move.label}
              tone={move.tone}
              title={move.why}
              run={() => admin.patch(`accounts/${encodeURIComponent(accountReference)}/status`, { status: move.to })}
              onDone={reload}
            />
          ))}
          {!closed && (
            <Action
              label="Close"
              tone="danger"
              disabled={holdsFunds}
              title={holdsFunds
                ? 'The account still holds money. Move it out first: closing it here would strand the funds.'
                : 'Ends the relationship. The record is kept, because settled payments refer to it.'}
              confirm="Closing is terminal and cannot be undone. The record is kept for the audit trail."
              run={() => admin.remove(`accounts/${encodeURIComponent(accountReference)}`)}
              onDone={reload}
            />
          )}
          {closed && (
            <p className="text-xs text-ink-soft">
              A closed account offers no action. Reopening it would let one reference mean two relationships.
            </p>
          )}
        </div>
        {holdsFunds && !closed && (
          <p className="mt-3 text-pretty text-[11px] leading-relaxed text-ink-soft">
            The close action is unavailable while the account holds {(account.availableAmount ?? 0).toFixed(2)}{' '}
            {account.accountCurrency}. The bank refuses it too, so this only saves the round trip.
          </p>
        )}
      </Panel>

      {/* ── The cards that draw on it ──────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard size={16} className="text-accent" aria-hidden />
          <h2 className="text-sm font-semibold">Cards drawing on this account</h2>
        </div>
        <p className="text-pretty text-xs leading-relaxed text-ink-soft">
          Every one of these is a debit card, so an authorisation on any of them is a hold against the balance
          above. The same list, filters and export as the full estate, narrowed to this account.
        </p>
        <CardsList
          fixed={{ account: account.accountArrangementInstanceReference }}
          heading={<span className="sr-only">Cards on this account</span>}
        />
      </section>

      <Panel title="The record as the bank holds it" description="What the account record stores, with no decrypted value in it.">
        <JsonView data={account} title="Account record" collapsed={1} />
      </Panel>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-1 truncate font-mono text-lg" title={value}>{value}</p>
      {hint && <p className="mt-0.5 text-pretty text-[11px] leading-relaxed text-ink-soft">{hint}</p>}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/accounts" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
      <ArrowLeft size={14} aria-hidden /> Accounts
    </Link>
  );
}

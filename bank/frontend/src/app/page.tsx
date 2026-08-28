import {
  BellRing, CreditCard, FileSearch, Landmark, ScrollText, ShieldCheck, Users,
} from 'lucide-react';
import { bankHealth } from '../lib/bankApi';
import { TileGrid, SectionHeading, PageTitle, type Tile } from '../components/Tiles';

// The bank's administration, in the bank's own app.
//
// These screens used to live in the provider's frontend, reaching the bank through a proxy there. That was
// the right shape while the bank had no frontend of its own; it is the wrong one now, because it left the
// provider carrying the bank's administration and gave one browser origin two institutions' concerns.
//
// Three groups, and the order is the order an operator arrives in. They come for a RECORD far more often than
// for a rule: a card to look at, an account to approve, a party to identify. The rules are what you change once
// and then leave alone, and the logs are where you go when something has already happened.

const DATA: Tile[] = [
  {
    href: '/cards',
    label: 'Card estate',
    icon: CreditCard,
    description: 'Every card this bank issued, with its lifecycle. Numbers stay encrypted: a list decrypts nothing, and one card discloses on request.',
  },
  {
    href: '/accounts',
    label: 'Accounts',
    icon: Landmark,
    description: 'The accounts this bank holds, their balances and the approval step each one passed through.',
  },
  {
    href: '/holders',
    label: 'Parties',
    icon: Users,
    description: 'The customers behind those accounts and cards. Names and contacts arrive masked, because they are encrypted at rest.',
  },
];

const RULES: Tile[] = [
  {
    href: '/rules/card-issuer',
    label: 'Card Issuer',
    icon: CreditCard,
    description: 'What this issuer validates a card against: the accepted verification value, its mode, the check digit, the recognised networks.',
  },
  {
    href: '/rules/card-authorization',
    label: 'Card Authorisation',
    icon: ShieldCheck,
    description: 'How the authorisation hold behaves, and the response codes it answers with.',
  },
  {
    href: '/rules/aisp',
    label: 'Account Information',
    icon: Users,
    description: 'What a third party may read from an account, and the ceiling on how much at once.',
  },
  {
    href: '/rules/pisp',
    label: 'Payment Initiation',
    icon: ScrollText,
    description: 'The payment products this bank offers, and the largest instruction it accepts.',
  },
  {
    href: '/rules/credit-bureau',
    label: 'Credit Bureau',
    icon: FileSearch,
    description: 'How this bank scores a party it banks: base score, rating bands, and what its own records earn or cost.',
  },
  {
    href: '/rules/consent',
    label: 'Consent',
    icon: ScrollText,
    description: 'Whether a new consent lands usable or waits for the account holder, and how long it stays valid.',
  },
];

const RECORDS: Tile[] = [
  {
    href: '/records/tpp/registrations',
    label: 'Third-party registrations',
    icon: Users,
    description: 'Which clients may reach this banking API, and what each was granted.',
  },
  {
    href: '/records/consents',
    label: 'Consents',
    icon: ScrollText,
    description: 'Account access agreements and their status, including any awaiting authorisation.',
  },
  {
    href: '/records/tpp/deliveries',
    label: 'Notification deliveries',
    icon: BellRing,
    description: 'One row per attempt, so a notification that never arrived is visible rather than silent.',
  },
  {
    href: '/records/audit',
    label: 'Audit trail',
    icon: FileSearch,
    description: 'Every request this bank answered: who asked, of what, under which consent, and the outcome. Searchable and exportable.',
  },
];

const HEALTH_STYLE: Record<string, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  degraded: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  unreachable: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

const HEALTH_TEXT: Record<string, string> = {
  ok: 'Answering, with its database reachable.',
  degraded: 'Answering, but reporting a failing check. Its own logs say which.',
  unreachable: 'Not answering. Nothing below will load until it does.',
};

export default async function BankAdminHome() {
  const health = await bankHealth();

  return (
    <div className="space-y-8">
      <PageTitle
        title="Administration"
        description="This bank's own records, rules and logs. Every screen here talks to this bank and to nothing else: the browser holds no token and never learns the bank's host."
      />

      {/* Health first, because a screen that loads nothing is only explicable once you know the bank is down. */}
      <div className={`rounded-xl border p-3 sm:p-4 ${HEALTH_STYLE[health.status] ?? HEALTH_STYLE.unreachable}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide">{health.status}</span>
          <span className="text-xs opacity-90">{HEALTH_TEXT[health.status]}</span>
          {health.detail && <span className="w-full text-[11px] opacity-70 sm:w-auto">{health.detail}</span>}
        </div>
      </div>

      <section className="space-y-3">
        <SectionHeading>The bank&apos;s own data</SectionHeading>
        <TileGrid tiles={DATA} />
      </section>

      <section className="space-y-3">
        <SectionHeading>Rules and policies</SectionHeading>
        <TileGrid tiles={RULES} />
      </section>

      <section className="space-y-3">
        <SectionHeading>Records and logs</SectionHeading>
        <TileGrid tiles={RECORDS} />
      </section>
    </div>
  );
}

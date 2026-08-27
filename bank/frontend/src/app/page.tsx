import { CreditCard, ShieldCheck, Users, FileSearch, ScrollText, BellRing } from 'lucide-react';
import { bankHealth } from '../lib/bankApi';
import { TileGrid, SectionHeading, PageTitle, type Tile } from '../components/Tiles';

// The bank's administration, in the bank's own app.
//
// These screens used to live in the provider's frontend, reaching the bank through a proxy there. That was
// the right shape while the bank had no frontend of its own; it is the wrong one now, because it left the
// provider carrying the bank's administration and gave one browser origin two institutions' concerns.

const CAPABILITIES: Tile[] = [
  {
    href: '/modules/card-issuer',
    label: 'Card Issuer',
    icon: CreditCard,
    description: 'What this issuer validates a card against: the accepted verification value, its mode, the check digit, the supported networks.',
  },
  {
    href: '/modules/card-authorization',
    label: 'Card Authorisation',
    icon: ShieldCheck,
    description: 'How the authorisation hold behaves, and the response codes it answers with.',
  },
  {
    href: '/modules/aisp',
    label: 'Account Information',
    icon: Users,
    description: 'What a third party may read from an account, and the ceiling on how much at once.',
  },
  {
    href: '/modules/pisp',
    label: 'Payment Initiation',
    icon: ScrollText,
    description: 'The payment products this bank offers, and the largest instruction it accepts.',
  },
  {
    href: '/modules/credit-bureau',
    label: 'Credit Bureau',
    icon: FileSearch,
    description: 'How this bank scores a party it banks: base score, rating bands, and what its own records earn or cost.',
  },
  {
    href: '/modules/consent',
    label: 'Consent',
    icon: ScrollText,
    description: 'Whether a new consent lands usable or waits for an operator, and how long it stays valid.',
  },
];

const RECORDS: Tile[] = [
  {
    href: '/records/tpp%2Fregistrations',
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
    href: '/records/tpp%2Fdeliveries',
    label: 'Notification deliveries',
    icon: BellRing,
    description: 'One row per attempt, so a notification that never arrived is visible rather than silent.',
  },
  {
    href: '/records/audit',
    label: 'Audit trail',
    icon: FileSearch,
    description: 'Every request this bank answered: who asked, of what, under which consent, and the outcome.',
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
        description="This bank's own capabilities and records. Every screen here talks to this bank and to nothing else: the browser holds no token and never learns the bank's host."
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
        <SectionHeading>Capabilities</SectionHeading>
        <TileGrid tiles={CAPABILITIES} />
      </section>

      <section className="space-y-3">
        <SectionHeading>Records</SectionHeading>
        <TileGrid tiles={RECORDS} />
      </section>
    </div>
  );
}

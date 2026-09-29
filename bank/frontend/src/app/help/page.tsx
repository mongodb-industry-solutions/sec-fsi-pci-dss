import Link from 'next/link';
import { ArrowRight, Check, X } from 'lucide-react';
import { PageTitle, SectionHeading } from '../../components/Tiles';
import { Panel } from '../../components/Reveal';
import { BANK_ROLE_GUIDE } from '../../config/bankRoleGuide';

export const metadata = { title: 'What BankCore is' };

// The section that answers the questions a demo raises and no screen alone can: what this system is for,
// where its responsibility ends, and why a permission was refused.

const DOES = [
  'Holds the accounts, the balances and the ledger movements. This is the book of record, not a copy of one.',
  'Issues cards and keeps their numbers in a vault, encrypted, disclosed one at a time through an audited request.',
  'Keeps the party records behind those accounts, with names and contacts encrypted at rest.',
  'Exposes an Open Banking API so a registered third party can read an account or initiate a payment on a customer’s instruction.',
  'Enforces the consent that third party operates under, and lets it be revoked.',
  'Applies its own rules: what the issuer validates, how an authorisation hold behaves, how a party is scored.',
  'Records every request it answered, in a trail nothing in the application can choose to skip.',
];

const DOES_NOT = [
  'Does not authenticate anybody. Sign-in, credentials and roles belong to the identity authority; this bank verifies a token and reads the claims in it.',
  'Does not store a password, ever.',
  'Does not decide who holds which role. It publishes the permissions it enforces and the authority grants them.',
  'Does not acquire card payments from merchants. That is the payment provider’s side of the demo, a separate institution with its own database.',
  'Does not move money outside itself. A transfer leaves through a scheme, and the bank records the instruction and the outcome.',
  'Does not hand a card number or an account number to a page. Those are requested, one at a time, by somebody the trail can name.',
];

export default function BankHelpOverview() {
  return (
    <div className="space-y-8">
      <PageTitle
        title="What BankCore is"
        description="A bank’s own core system: the accounts it holds, the cards it issued, the customers behind them, and the API it opens to regulated third parties. This section explains what it is responsible for, what it deliberately is not, and which role may do what."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="What it is responsible for" description="If it is wrong here, it is this bank’s problem.">
          <ul className="space-y-2.5">
            {DOES.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-soft">
                <Check size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <span className="text-pretty">{item}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="What it deliberately is not" description="Each of these is somebody else’s job, and the boundary is the design.">
          <ul className="space-y-2.5">
            {DOES_NOT.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-soft">
                <X size={15} className="mt-0.5 shrink-0 text-ink-soft" aria-hidden />
                <span className="text-pretty">{item}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Why a screen sometimes refuses you"
        description="Access is decided by permission, not by page. A screen you can open may still refuse an action on it."
      >
        <div className="space-y-3 text-sm leading-relaxed text-ink-soft">
          <p className="text-pretty">
            Every sensitive route names the resource and the action it needs, and the bank checks that pair against the
            claims in your token. Nothing is inferred: authority to administer a card does not imply authority to read
            its number, and neither implies authority to read the log of who did. An absent permission is a refusal, not
            an unrestricted one.
          </p>
          <p className="text-pretty">
            So revealing an account number needs a permission distinct from viewing the account, and revealing a card
            number is a third one held by exactly one role. When you see{' '}
            <span className="font-mono text-xs text-ink">your role does not permit …</span>, the role page below says who
            does hold it and why it was kept away from yours.
          </p>
        </div>
      </Panel>

      <section className="space-y-3">
        <SectionHeading>The roles</SectionHeading>
        <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BANK_ROLE_GUIDE.map((role) => (
            <Link
              key={role.id}
              href={`/help/roles/${role.id}`}
              className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 transition hover:border-accent focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white ${role.avatar}`}>
                <role.icon size={15} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{role.label}</p>
                <p className="mt-0.5 text-pretty text-xs leading-relaxed text-ink-soft">{role.headline}</p>
              </div>
              <ArrowRight
                size={16}
                className="mt-0.5 shrink-0 text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-accent"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

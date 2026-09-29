import Link from 'next/link';
import { BookOpen, CreditCard, FileSearch, Landmark, LogIn, Lock, ScrollText, ShieldCheck, TriangleAlert } from 'lucide-react';

/**
 * What BankCore is, for whoever arrives before signing in.
 *
 * The app used to open on the sign-in card, which asks for a credential before saying what the thing is
 * or who it belongs to. This says it first, the way the merchant's front door does, and keeps the same
 * single Sign In action: the credential is still entered at the identity authority and never here.
 *
 * Colours are stated rather than inherited on the card surfaces, because `--bank-ink` is white and
 * correct only on the dark header.
 */

const CAPABILITIES = [
  {
    icon: CreditCard,
    title: 'Issues and holds',
    body: 'The card estate and the accounts behind it, each with the lifecycle and the approval step it passed through.',
  },
  {
    icon: Lock,
    title: 'Encrypted, still searchable',
    body: 'Card numbers and party details are encrypted at rest. A list decrypts nothing; a single record discloses on request.',
  },
  {
    icon: ScrollText,
    title: 'Open Banking API',
    body: 'Account information and payment initiation for registered third parties, under consent the account holder controls.',
  },
  {
    icon: FileSearch,
    title: 'Answerable',
    body: 'Every request the bank answered is on the audit trail: who asked, of what, under which consent, and the outcome.',
  },
];

export function Landing({ error, gated }: { error?: string | null; gated?: boolean }) {
  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-line bg-bank p-6 text-bank-ink sm:p-10">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-bank-ink/20 px-3 py-1 text-[10px] uppercase tracking-wide text-bank-ink/70">
          <Landmark size={13} className="text-accent" aria-hidden /> ASPSP
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">BankCore</h1>
        <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-bank-ink/80">
          The bank in this platform, as its own institution: it holds the accounts, issues the cards, keeps its own
          records and rules, and exposes the banking API the payment provider consumes. Nothing here is the provider&apos;s,
          and no screen on this app talks to anything but this bank.
        </p>

        {gated && (
          <p className="mt-4 max-w-2xl text-sm text-bank-ink/70">
            That page belongs to the back office, so it needs a signed-in member of staff.
          </p>
        )}

        {error && (
          <div className="mt-4 max-w-2xl rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert size={15} aria-hidden /> Sign-in could not be completed
            </p>
            <p className="mt-1 text-bank-ink/80">{error}</p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href="/api/auth/login"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <LogIn size={16} aria-hidden /> Sign in
          </a>
          <Link
            href="/help"
            className="inline-flex items-center gap-2 rounded-lg border border-bank-ink/20 px-5 py-2.5 font-semibold text-bank-ink transition hover:border-bank-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <BookOpen size={16} aria-hidden /> How this works
          </Link>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-bank-ink/60">
          <ShieldCheck size={13} aria-hidden />
          You sign in at the identity authority, the only place on this platform that accepts a credential. What you
          can reach afterwards depends on the role you hold.
        </p>
      </section>

      <section className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2">
        {CAPABILITIES.map((c) => (
          <div key={c.title} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-ink">
            <c.icon size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{c.title}</p>
              <p className="mt-0.5 text-pretty text-xs leading-relaxed text-ink-soft">{c.body}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

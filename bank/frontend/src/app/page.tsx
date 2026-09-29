import { bankHealth } from '../lib/bankApi';
import { currentStaff } from '../lib/authority';
import { accessFor } from '../lib/access';
import { destinationsFor, type DestinationSection } from '../lib/destinations';
import { TileGrid, SectionHeading, PageTitle, type Tile } from '../components/Tiles';

// The bank's administration, in the bank's own app.
//
// These screens used to live in the provider's frontend, reaching the bank through a proxy there. That was
// the right shape while the bank had no frontend of its own; it is the wrong one now, because it left the
// provider carrying the bank's administration and gave one browser origin two institutions' concerns.
//
// Tiles are drawn from the shared destination catalog (`lib/destinations`), filtered to what this person's
// roles actually grant. Every tile used to render unconditionally, so an account holder saw the rules, the
// audit trail and the third-party register and met a refusal on each: a page promising authority the token
// does not carry. A section with nothing left in it is left out entirely rather than shown empty.

const SECTION_HEADING: Record<DestinationSection, string> = {
  data: "The bank's own data",
  rules: 'Rules and policies',
  records: 'Records and logs',
};

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
  const [health, staff] = await Promise.all([bankHealth(), currentStaff()]);
  const access = accessFor(staff?.roles);

  const sections: Array<{ section: DestinationSection; tiles: Tile[] }> = (['data', 'rules', 'records'] as const)
    .map((section) => ({
      section,
      tiles: destinationsFor(access, { accountHolderRef: staff?.accountHolderRef })
        .filter((destination) => destination.section === section),
    }))
    .filter(({ tiles }) => tiles.length > 0);

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

      {sections.map(({ section, tiles }) => (
        <section key={section} className="space-y-3">
          <SectionHeading>{SECTION_HEADING[section]}</SectionHeading>
          <TileGrid tiles={tiles} />
        </section>
      ))}
    </div>
  );
}

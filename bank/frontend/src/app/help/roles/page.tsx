import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageTitle } from '../../../components/Tiles';
import { Panel } from '../../../components/Reveal';
import { BANK_ROLE_GUIDE } from '../../../config/bankRoleGuide';

export const metadata = { title: 'Roles' };

// The directory. One row per role, with the single sentence that distinguishes it from the other four, and the
// one thing it cannot do, because that is what a reader is usually here to find out.

export default function BankHelpRoles() {
  return (
    <div className="space-y-6">
      <PageTitle
        title="Roles"
        description="Five roles, drawn so that no one of them can both act and review the act. Open one to see exactly what it may do, what it may not, and the reasoning behind each line."
      />

      <Panel
        title="How to read these"
        description="A role is a set of permissions, each a resource plus an action. There is no hierarchy between them."
      >
        <p className="text-pretty text-sm leading-relaxed text-ink-soft">
          Administering something does not imply reading it and reading it does not imply revealing it. Four roles see
          the whole bank and are limited by what they may do with it; one, the account holder, is bound instead to their
          own records, so two people holding it reach entirely different data.
        </p>
      </Panel>

      <div className="space-y-3">
        {BANK_ROLE_GUIDE.map((role) => (
          <Link
            key={role.id}
            href={`/help/roles/${role.id}`}
            className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 transition hover:border-accent focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${role.avatar}`}>
              <role.icon size={16} aria-hidden />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{role.label}</p>
                <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-soft">
                  {role.scope === 'self' ? 'own records only' : 'whole bank'}
                </span>
              </div>
              <p className="text-pretty text-xs leading-relaxed text-ink-soft">{role.headline}</p>
              <p className="text-pretty text-xs leading-relaxed text-ink-soft">
                <span className="font-medium text-ink">Cannot:</span> {role.cannot[0].what.toLowerCase()}.
              </p>
            </div>
            <ArrowRight
              size={16}
              className="mt-0.5 shrink-0 text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-accent"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </div>
  );
}

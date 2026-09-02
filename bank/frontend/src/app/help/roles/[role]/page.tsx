import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, Scale, X } from 'lucide-react';
import { PageTitle } from '../../../../components/Tiles';
import { Field, Panel } from '../../../../components/Reveal';
import { BANK_ROLE_GUIDE, findRoleGuide, type RoleAbility } from '../../../../config/bankRoleGuide';

// One role, in full. The `cannot` list is given the same weight as the `can` list on purpose: an operator who
// has just been refused something is reading this page to find out whether that was a bug, and the reason
// beside each line is the answer.

export function generateStaticParams() {
  return BANK_ROLE_GUIDE.map((role) => ({ role: role.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  return { title: findRoleGuide(role)?.label ?? 'Role' };
}

export default async function BankRoleDetail({ params }: { params: Promise<{ role: string }> }) {
  const { role: roleId } = await params;
  const role = findRoleGuide(roleId);
  if (!role) notFound();

  return (
    <div className="space-y-6">
      <Link href="/help/roles" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowLeft size={13} aria-hidden />
        All roles
      </Link>

      <div className="flex items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${role.avatar}`}>
          <role.icon size={20} aria-hidden />
        </span>
        <PageTitle title={role.label} description={role.headline} />
      </div>

      <Panel title="What this role is for">
        <p className="text-pretty text-sm leading-relaxed text-ink-soft">{role.purpose}</p>
        <div className="mt-3">
          <Field label="Typically held by">{role.who}</Field>
          <Field label="Reach">
            {role.scope === 'self'
              ? 'Their own records only, bound to the signed-in identity'
              : 'Every record in the bank, limited by action rather than by row'}
          </Field>
          <Field label="Role name" mono>{role.id}</Field>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="What it may do" description="Each line is a permission the identity authority actually grants.">
          <AbilityList items={role.can} tone="can" />
        </Panel>

        <Panel title="What it may not do" description="Each line is a permission deliberately withheld, and the reason it was.">
          <AbilityList items={role.cannot} tone="cannot" />
        </Panel>
      </div>

      <Panel title="Why the role is drawn this way">
        <div className="flex items-start gap-2.5">
          <Scale size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <p className="text-pretty text-sm leading-relaxed text-ink-soft">{role.separation}</p>
        </div>
      </Panel>
    </div>
  );
}

function AbilityList({ items, tone }: { items: RoleAbility[]; tone: 'can' | 'cannot' }) {
  const Icon = tone === 'can' ? Check : X;
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.what} className="flex items-start gap-2.5 border-b border-line pb-3 last:border-b-0 last:pb-0">
          <Icon
            size={15}
            className={`mt-0.5 shrink-0 ${tone === 'can' ? 'text-accent' : 'text-ink-soft'}`}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-pretty text-sm font-medium">{item.what}</p>
            <p className="mt-0.5 text-pretty text-xs leading-relaxed text-ink-soft">{item.why}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CreditCard, Landmark } from 'lucide-react';
import { callBankAdmin } from '../../../lib/bankApi';
import { PageTitle } from '../../../components/Tiles';
import { BankError, Empty } from '../../../components/States';
import { RulesForm } from '../../../components/rules/RulesForm';
import { CAPABILITY_SCHEMAS } from '../../../components/rules/schema';

// One capability's rules, on their own URL.
//
// Rules and records used to share a page behind two tabs. They are two jobs: changing what the issuer accepts
// is not the same as looking at a card, and a tab cannot be linked to, cannot be returned to by a back button
// and leaves the wrong half showing. The records now live at `/cards` and `/accounts`, and this page links to
// them rather than embedding them.
//
// The bank reads this record PER CALL, which is the property that makes the screen worth having: a saved change
// applies to the next request with nothing restarting.

interface ConfigRecord {
  bankModuleCapability?: string;
  bankModuleConfiguration?: Record<string, unknown>;
  bankModuleConfigurationConsumed?: boolean;
}

// Where the records that capability governs actually live, so a rules page is one click from them.
const RECORDS: Record<string, { href: string; label: string; icon: typeof CreditCard }> = {
  'card-issuer': { href: '/cards', label: 'Card estate', icon: CreditCard },
  'card-authorization': { href: '/cards', label: 'Card estate', icon: CreditCard },
  aisp: { href: '/accounts', label: 'Accounts', icon: Landmark },
  pisp: { href: '/records/payments', label: 'Payments', icon: Landmark },
};

export default async function RulesPage({ params }: { params: Promise<{ capability: string }> }) {
  const { capability } = await params;
  const schema = CAPABILITY_SCHEMAS[capability];
  if (!schema) notFound();

  const result = await callBankAdmin(`module/config/${capability}`);
  const record = (result.body ?? null) as ConfigRecord | null;
  const records = RECORDS[capability];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
          <ArrowLeft size={14} aria-hidden /> Administration
        </Link>
        {records && (
          <Link href={records.href} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            <records.icon size={14} aria-hidden /> {records.label}
          </Link>
        )}
      </div>

      <PageTitle title={`${schema.title} rules`} description={schema.description} />

      {result.error && <BankError message={result.error} />}

      {!result.error && !record?.bankModuleConfiguration && (
        <Empty>
          This bank holds no configuration record for that capability, so its engine is running on the defaults
          it ships with.
        </Empty>
      )}

      {record?.bankModuleConfiguration && (
        <RulesForm
          capability={capability}
          initial={record.bankModuleConfiguration}
          consumed={record.bankModuleConfigurationConsumed !== false}
        />
      )}
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { callBankAdmin } from '../../../lib/bankApi';
import { ConfigEditor } from '../../../components/ConfigEditor';
import { PageTitle } from '../../../components/Tiles';
import { BankError, Empty } from '../../../components/States';
import { ModuleTabs, type Tab } from '../../../components/ModuleTabs';
import { CardsAdmin } from '../../../components/CardsAdmin';
import { AccountsAdmin } from '../../../components/AccountsAdmin';

// One capability's live rules, read from and written to the bank's own configuration record.
//
// The bank's engines read that record PER CALL, so a change here takes effect on the next request without a
// restart. That is the property this screen exists to make usable: the accepted card verification value, for
// instance, is a configured value rather than a constant in code, and this is where an operator changes it.

const KNOWN: Record<string, { title: string; description: string }> = {
  'card-issuer': {
    title: 'Card Issuer',
    description:
      'What this issuer accepts. `validCvv` is the global escape-hatch value and `cvvMode` decides whether it '
      + 'is honoured, whether only the per-card derived value is, or either. `enforceLuhn` and the network list '
      + 'complete the format rules. Every one is read per call.',
  },
  'card-authorization': {
    title: 'Card Authorisation',
    description: 'How the authorisation hold behaves. The response codes it answers with are the card rail\'s own.',
  },
  aisp: {
    title: 'Account Information',
    description: 'What a third party may read, and the ceiling on how much of it at once.',
  },
  pisp: {
    title: 'Payment Initiation',
    description: 'The payment products this bank offers, and the largest instruction it will accept.',
  },
  'credit-bureau': {
    title: 'Credit Bureau',
    description:
      'How this bank scores a party it banks: the base score, the rating bands, the points a relationship and '
      + 'a balance earn, and what a returned payment costs.',
  },
  consent: {
    title: 'Consent',
    description: 'Whether a new consent lands usable or waits for an operator, and how long it stays valid.',
  },
};

// The capabilities that own records as well as rules. An operator fixing the issuer needs both halves in one
// place, which is how the provider's module pages worked and why they were usable.
const DATA_PANEL: Record<string, { label: string; render: () => React.ReactNode }> = {
  'card-issuer': { label: 'Cards', render: () => <CardsAdmin /> },
  aisp: { label: 'Accounts', render: () => <AccountsAdmin /> },
};

interface ConfigRecord {
  bankModuleCapability?: string;
  bankModuleDescription?: string;
  bankModuleConfiguration?: Record<string, unknown>;
  bankModuleConfigurationConsumed?: boolean;
}

export default async function CapabilityPage({ params }: { params: Promise<{ capability: string }> }) {
  const { capability } = await params;
  const meta = KNOWN[capability];
  if (!meta) notFound();

  const result = await callBankAdmin(`module/config/${capability}`);
  const record = (result.body ?? null) as ConfigRecord | null;

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowLeft size={14} /> Administration
      </Link>

      <PageTitle title={meta.title} description={meta.description} />

      {result.error && <BankError message={result.error} />}

      {!result.error && !record?.bankModuleConfiguration && (
        <Empty>
          This bank holds no configuration record for that capability, so its engine is running on its shipped
          defaults.
        </Empty>
      )}

      {record?.bankModuleConfiguration && (
        <ModuleTabs tabs={tabsFor(capability, record)} initial={DATA_PANEL[capability] ? 'data' : 'rules'} />
      )}
    </div>
  );
}

function tabsFor(capability: string, record: ConfigRecord): Tab[] {
  const data = DATA_PANEL[capability];
  const rules: Tab = {
    key: 'rules',
    label: 'Rules and policies',
    content: (
      <div className="space-y-4">
        {record.bankModuleConfigurationConsumed === false && (
          // Worth saying plainly: a record nothing reads is a setting that looks live and is not.
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-300">
            This record exists but no engine reads it yet, so editing it changes nothing until one does.
          </div>
        )}
        <ConfigEditor capability={capability} initial={record.bankModuleConfiguration ?? {}} />
      </div>
    ),
  };
  // Data first when there is any: an operator arrives looking for a record far more often than for a rule.
  return data ? [{ key: 'data', label: data.label, content: data.render() }, rules] : [rules];
}

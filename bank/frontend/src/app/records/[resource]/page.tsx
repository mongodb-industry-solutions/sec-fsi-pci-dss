import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { callBankAdmin } from '../../../lib/bankApi';
import { PageTitle } from '../../../components/Tiles';
import { RecordList } from '../../../components/RecordList';
import { BankError, Empty } from '../../../components/States';

// One of the bank's administrative records, read on the server so the browser holds no token.

const TITLES: Record<string, { title: string; description: string }> = {
  'tpp/registrations': {
    title: 'Third-party registrations',
    description: 'Which clients may reach this banking API, and what each was granted. A client with no active registration cannot obtain a token at all.',
  },
  consents: {
    title: 'Consents',
    description: 'Account access agreements and their status. A consent that is created is not yet authorised, which is the distinction the status carries.',
  },
  'tpp/deliveries': {
    title: 'Notification deliveries',
    description: 'One row per ATTEMPT, so a retry that eventually succeeded reads differently from a first-time success. A notification that silently never arrived is the failure that leaves a transfer stuck with nothing to look at.',
  },
  audit: {
    title: 'Audit trail',
    description: 'Every request this bank answered: who asked, of what, under which consent, and the outcome. It carries no request bodies and no cardholder data by design, because a trail that copies the payload becomes a second place the sensitive data lives.',
  },
  'tpp/subscriptions': {
    title: 'Notification subscriptions',
    description: 'Where this bank delivers notifications, and how it signs them.',
  },
};

export default async function RecordsPage({ params }: { params: Promise<{ resource: string }> }) {
  const { resource: raw } = await params;
  const resource = decodeURIComponent(raw);
  const meta = TITLES[resource] ?? { title: resource, description: "One of the bank's administrative records." };

  const result = await callBankAdmin(resource, { query: { limit: '50' } });
  const body = result.body as { results?: Record<string, unknown>[] } | Record<string, unknown>[] | null;
  const rows = Array.isArray(body) ? body : body?.results ?? [];

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
        <ArrowLeft size={14} aria-hidden /> Administration
      </Link>

      <PageTitle title={meta.title} description={meta.description} />

      {result.error && <BankError message={result.error} />}
      {!result.error && rows.length === 0 && <Empty>This bank holds no records here yet.</Empty>}
      {rows.length > 0 && (
        <>
          <p className="text-xs text-ink-soft">
            {rows.length} record{rows.length === 1 ? '' : 's'}, newest first.
          </p>
          <RecordList rows={rows} />
        </>
      )}
    </div>
  );
}

'use client';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DataList, type Column } from '../data/DataList';
import { StatusBadge } from '../data/StatusBadge';

// The accounts this bank holds.
//
// No full IBAN in any row, and no holder name in the clear. Both are encrypted, and a list that returned them
// would decrypt a page of personal data on every request. What a row carries is the masked IBAN, which is the
// form that appears on a statement, and the masked name, which is enough to recognise a record an operator
// already knows.
//
// The search is honest about the same constraint. An EXACT IBAN is findable, because that field carries an
// equality index; a partial one is not, and the masked form is what covers the last four an operator usually
// has. A name search is not offered at all, because the name carries no query index and the box would match
// nothing while looking like it worked.

export interface AccountRow extends Record<string, unknown> {
  accountArrangementInstanceReference: string;
  accountHolderInstanceReference: string;
  accountHolderNameMasked?: string;
  accountKind: string;
  accountStatus: string;
  accountAlias?: string;
  accountCurrency: string;
  accountMaskedIban: string;
  accountBic: string;
  availableAmount: number;
  reservedAmount: number;
}

function money(amount: unknown, currency: unknown): string {
  const value = typeof amount === 'number' ? amount : 0;
  return `${value.toFixed(2)} ${String(currency ?? '')}`.trim();
}

const COLUMNS: Column<AccountRow>[] = [
  {
    key: 'accountMaskedIban',
    label: 'Account',
    render: (row) => (
      <span className="font-mono">{row.accountMaskedIban}</span>
    ),
  },
  { key: 'accountHolderNameMasked', label: 'Holder' },
  { key: 'accountKind', label: 'Kind' },
  { key: 'accountStatus', label: 'Status', render: (row) => <StatusBadge status={row.accountStatus} /> },
  {
    key: 'availableAmount',
    label: 'Available',
    align: 'right',
    render: (row) => <span className="font-mono">{money(row.availableAmount, row.accountCurrency)}</span>,
  },
  {
    key: 'reservedAmount',
    label: 'Held',
    align: 'right',
    secondary: true,
    render: (row) => <span className="font-mono">{money(row.reservedAmount, row.accountCurrency)}</span>,
  },
  { key: 'accountBic', label: 'Bank code', secondary: true },
];

export function AccountsList({ fixed, toolbar }: { fixed?: Record<string, string>; toolbar?: React.ReactNode }) {
  return (
    <DataList<AccountRow>
      resource="accounts"
      noun="accounts"
      searchHint="Masked account, alias, reference or a full IBAN"
      columns={COLUMNS}
      statusFilterKey="status"
      fixed={fixed}
      rowKey={(row) => row.accountArrangementInstanceReference}
      rowHref={(row) => `/accounts/${encodeURIComponent(row.accountArrangementInstanceReference)}`}
      emptyMessage="This bank holds no accounts matching that."
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: [
            { value: 'pending_approval', label: 'Waiting for approval' },
            { value: 'active', label: 'Active' },
            { value: 'blocked', label: 'Blocked' },
            { value: 'closed', label: 'Closed' },
          ],
        },
        {
          key: 'kind',
          label: 'Kind',
          options: [
            { value: 'current', label: 'Current' },
            { value: 'savings', label: 'Savings' },
          ],
        },
        { key: 'currency', label: 'Currency', placeholder: 'EUR' },
        { key: 'holder', label: 'Holder reference', placeholder: 'Exact reference' },
      ]}
      toolbar={toolbar ?? (
        <Link
          href="/accounts/new"
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-accent bg-accent px-3 text-sm text-canvas transition hover:opacity-90 sm:h-9"
        >
          <Plus size={14} aria-hidden /> <span className="hidden sm:inline">Open an account</span>
        </Link>
      )}
    />
  );
}

'use client';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DataList, type Column } from '../data/DataList';
import { StatusBadge } from '../data/StatusBadge';

// The estate of cards this bank issued.
//
// What is NOT here is the point: no card number, in any row, ever. The number lives encrypted in the vault and
// arrives one card at a time as a disclosure, so a list of two hundred cards decrypts nothing. What a row
// carries is the surrogate token, the last four and the masked display, which are exactly the values the card
// rules allow on a screen.
//
// The search reflects that too. It runs over the token, the last four, the BIN and the masked display, because
// those are the plaintext that exists. The number is not searchable and the list says so rather than offering a
// box that silently matches nothing.

export interface CardRow extends Record<string, unknown> {
  cardToken: string;
  network: string;
  kind: string;
  bin: string;
  lastFour: string;
  maskedDisplay: string;
  status: string;
  expiryMonth?: string;
  expiryYear?: string;
  limits?: { perTransactionAmount?: number; limitCurrency?: string };
  holderReference?: string;
  fundingAccountReference?: string;
}

const COLUMNS: Column<CardRow>[] = [
  {
    key: 'maskedDisplay',
    label: 'Card',
    render: (row) => (
      <span className="font-mono">{row.maskedDisplay || `•••• ${row.lastFour}`}</span>
    ),
  },
  { key: 'network', label: 'Network' },
  { key: 'kind', label: 'Type' },
  { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
  {
    key: 'expiry',
    label: 'Expires',
    secondary: true,
    render: (row) => (row.expiryMonth ? `${row.expiryMonth}/${row.expiryYear}` : ''),
  },
  { key: 'bin', label: 'Range', secondary: true },
  { key: 'cardToken', label: 'Token', secondary: true },
];

export function CardsList({ fixed, heading }: { fixed?: Record<string, string>; heading?: React.ReactNode }) {
  return (
    <DataList<CardRow>
      resource="cards"
      noun="cards"
      searchHint="Token, last four, range or masked number"
      columns={COLUMNS}
      statusFilterKey="status"
      fixed={fixed}
      rowKey={(row) => row.cardToken}
      rowHref={(row) => `/cards/${encodeURIComponent(row.cardToken)}`}
      emptyMessage="This issuer has no cards matching that."
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: [
            { value: 'issued', label: 'Issued, not yet accepted' },
            { value: 'active', label: 'Active' },
            { value: 'suspended', label: 'Suspended' },
            { value: 'revoked', label: 'Revoked' },
          ],
        },
        {
          key: 'kind',
          label: 'Type',
          options: [
            { value: 'debit', label: 'Debit' },
            { value: 'credit', label: 'Credit' },
          ],
        },
        { key: 'network', label: 'Network', placeholder: 'VISA' },
        { key: 'last4', label: 'Last four', placeholder: '4242' },
        { key: 'bin', label: 'Range starts with', placeholder: '4571' },
        { key: 'holder', label: 'Holder reference', placeholder: 'Exact reference' },
      ]}
      toolbar={heading ?? (
        <Link
          href="/cards/new"
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-accent bg-accent px-3 text-sm text-canvas transition hover:opacity-90 sm:h-9"
        >
          <Plus size={14} aria-hidden /> <span className="hidden sm:inline">Issue a card</span>
        </Link>
      )}
    />
  );
}

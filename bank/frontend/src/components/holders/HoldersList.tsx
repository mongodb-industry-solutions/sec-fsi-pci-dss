'use client';
import { DataList, type Column } from '../data/DataList';
import { StatusBadge } from '../data/StatusBadge';

// The parties this bank holds accounts for.
//
// Every row is masked, and the search runs over the REFERENCE rather than the name. That is not a limitation
// this screen chose: the name is encrypted with no query index, so the bank cannot match it even exactly. A
// search box over names would return nothing while looking like it worked, which is the worst of the options.

interface HolderRow extends Record<string, unknown> {
  accountHolderInstanceReference: string;
  accountHolderNameMasked: string;
  accountHolderEmailMasked?: string;
  accountHolderCountryCode: string;
  accountHolderStatus: string;
}

const COLUMNS: Column<HolderRow>[] = [
  { key: 'accountHolderNameMasked', label: 'Name' },
  { key: 'accountHolderEmailMasked', label: 'Contact' },
  { key: 'accountHolderCountryCode', label: 'Country' },
  {
    key: 'accountHolderStatus',
    label: 'Status',
    render: (row) => <StatusBadge status={row.accountHolderStatus} />,
  },
  { key: 'accountHolderInstanceReference', label: 'Reference', secondary: true },
];

export function HoldersList() {
  return (
    <DataList<HolderRow>
      resource="holders"
      noun="parties"
      searchHint="Reference. Names are encrypted and cannot be searched."
      columns={COLUMNS}
      statusFilterKey="status"
      rowKey={(row) => row.accountHolderInstanceReference}
      rowHref={(row) => `/holders/${encodeURIComponent(row.accountHolderInstanceReference)}`}
      emptyMessage="This bank holds no parties matching that."
      filters={[
        {
          key: 'status',
          label: 'Status',
          options: [
            { value: 'active', label: 'Active' },
            { value: 'dormant', label: 'Dormant' },
            { value: 'closed', label: 'Closed' },
          ],
        },
        { key: 'country', label: 'Country', placeholder: 'ES' },
      ]}
    />
  );
}

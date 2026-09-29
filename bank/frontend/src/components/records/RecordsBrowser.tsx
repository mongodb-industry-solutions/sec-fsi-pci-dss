'use client';
import { DataList } from '../data/DataList';
import { RESOURCES } from './resources';

// The bank's administrative records: the audit trail, the consents, the registered third parties, the
// notification subscriptions and every delivery attempt.
//
// All five go through the SAME list as the cards and the accounts, which is what the shared page contract on
// the bank's side bought. Before it, these answered with a bare array and a `limit` that quietly truncated, so
// they could not be paged at all: "50 records" was what the screen said whether there were 50 or 5,000.
//
// The columns are derived from the records rather than declared, because these shapes belong to the bank. A
// fixed column list would need editing every time a field is added, and would hide the new one until someone
// did. Each row opens into the full document in the JSON viewer, which is what a log row actually needs: the
// interesting part of an audit entry is usually a nested value no column would have shown.

export function RecordsBrowser({ resource }: { resource: string }) {
  const meta = RESOURCES[resource];

  return (
    <DataList
      resource={resource}
      noun={meta?.noun ?? 'records'}
      searchHint={meta?.searchHint ?? 'Any reference'}
      columns="auto"
      filters={meta?.filters ?? []}
      statusFilterKey={meta?.statusKey}
      // The whole document, syntax highlighted. A log entry's substance is usually a nested value, and no
      // column would have shown it.
      expand="auto"
      emptyMessage={`This bank holds no ${meta?.noun ?? 'records'} matching that.`}
    />
  );
}

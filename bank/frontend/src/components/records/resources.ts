import type { FilterSpec } from '../data/DataList';

// What each administrative record set IS: its title, what it means, and the filters worth offering.
//
// A PLAIN module, deliberately. Two consumers need this table and they run in different places: the route is a
// server component, which reads it for the page title and to reject an unknown resource, and the list is a
// browser component, which reads it for the filters. Shared state imported by a server component should not
// live in a `'use client'` file, because what crosses that boundary is not guaranteed to be the value itself.
//
// Keeping it here also means the resource names exist in exactly one place. A title in one file and a filter
// set in another is how a resource ends up renamed on one screen and not the other.

export interface RecordMeta {
  title: string;
  description: string;
  noun: string;
  statusKey?: string;
  filters: FilterSpec[];
  searchHint: string;
}

// The date window every log-like resource offers. One definition, because "what happened on Tuesday" is the
// same question whichever record answers it, and one CONTROL rather than two boxes: it offers today,
// yesterday, the last week or month, a single whole day, or two moments with their times.
const DATE_FILTERS: FilterSpec[] = [
  { key: 'when', label: 'When', dateRange: { fromKey: 'from', toKey: 'to' } },
];

export const RESOURCES: Record<string, RecordMeta> = {
  audit: {
    title: 'Audit trail',
    noun: 'entries',
    description:
      'Every request this bank answered, newest first: who asked, of what, under which consent, and what it '
      + 'answered. It carries no request bodies and no card data by design, because a trail that copies the '
      + 'payload becomes a second place the sensitive data lives, and then the log is the thing that has to be '
      + 'protected. References and outcomes reconstruct what happened, which is what a reviewer reads.',
    searchHint: 'Actor, route or any reference',
    statusKey: 'outcome',
    filters: [
      {
        key: 'outcome',
        label: 'Outcome',
        options: [
          { value: 'granted', label: 'Granted' },
          { value: 'refused', label: 'Refused' },
          { value: 'failed', label: 'Failed' },
        ],
      },
      {
        key: 'channel',
        label: 'Channel',
        options: [
          { value: 'open_banking', label: 'Open Banking, a third party' },
          { value: 'admin', label: 'Administration' },
          { value: 'internal', label: 'Internal' },
        ],
      },
      { key: 'actor', label: 'Actor', placeholder: 'Client id or operator' },
      {
        key: 'resource',
        label: 'Any reference',
        placeholder: 'Consent, account, payment or card',
      },
      { key: 'correlationId', label: 'Correlation', placeholder: 'Follows one journey' },
      ...DATE_FILTERS,
    ],
  },
  consents: {
    title: 'Consents',
    noun: 'consents',
    description:
      'The access agreements this bank holds. A consent that has been CREATED is not yet a consent that is '
      + 'usable, and the status is what carries that distinction: one sitting at received is waiting for a '
      + 'decision.',
    searchHint: 'Consent reference or client id',
    statusKey: 'status',
    filters: [
      {
        key: 'status',
        label: 'Status',
        options: [
          { value: 'received', label: 'Received, awaiting authorisation' },
          { value: 'valid', label: 'Valid' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'revokedByPsu', label: 'Revoked by the account holder' },
          { value: 'expired', label: 'Expired' },
        ],
      },
      ...DATE_FILTERS,
    ],
  },
  'tpp/registrations': {
    title: 'Third-party registrations',
    noun: 'registrations',
    description:
      'Which clients may reach this banking API and what each was granted. A client with no active '
      + 'registration cannot obtain a token at all, so this is the record that grants access. The secret is '
      + 'never returned: an administration surface has no reason to disclose a verifier.',
    searchHint: 'Client id or name',
    statusKey: 'status',
    filters: [
      {
        key: 'status',
        label: 'Status',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'suspended', label: 'Suspended' },
          { value: 'withdrawn', label: 'Withdrawn' },
        ],
      },
    ],
  },
  'tpp/subscriptions': {
    title: 'Notification subscriptions',
    noun: 'subscriptions',
    description:
      'Where this bank delivers notifications and how it signs them. A subscription that omits an event type '
      + 'silently stops delivering it, which is why the event list is worth being able to read.',
    searchHint: 'Reference or callback address',
    filters: [
      {
        key: 'active',
        label: 'Active',
        options: [
          { value: 'true', label: 'Delivering' },
          { value: 'false', label: 'Stopped' },
        ],
      },
    ],
  },
  'tpp/deliveries': {
    title: 'Notification deliveries',
    noun: 'attempts',
    description:
      'One row per ATTEMPT, so a retry that eventually succeeded reads differently from a first-time success. '
      + 'This exists because a notification that silently never arrived is the failure that leaves a transfer '
      + 'stuck with nothing to look at.',
    searchHint: 'Subject reference, event type or endpoint',
    statusKey: 'outcome',
    filters: [
      {
        key: 'outcome',
        label: 'Outcome',
        options: [
          { value: 'delivered', label: 'Delivered' },
          { value: 'failed', label: 'Failed' },
          { value: 'skipped', label: 'Skipped' },
        ],
      },
      { key: 'eventType', label: 'Event type', placeholder: 'payment.settled' },
      { key: 'subject', label: 'Subject', placeholder: 'Consent or payment reference' },
      ...DATE_FILTERS,
    ],
  },
};


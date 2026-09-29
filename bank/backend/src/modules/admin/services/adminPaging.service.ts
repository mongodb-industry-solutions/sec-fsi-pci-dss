import { Collection, Document, Filter } from 'mongodb';
import { DEFAULT_LIMIT, MAX_LIMIT, Page } from './adminSearch.service';

// One paged read, for every administrative list this bank offers.
//
// It exists because the lists did not agree. The cards and the accounts answered with a total and a page
// number; the audit trail, the consents, the registrations and the delivery attempts answered with a bare
// array and a `limit` that quietly truncated. A screen cannot show "page 3 of 12" against a list that never
// says how many there are, so the administration app could not use one page control until every list spoke the
// same way.
//
// The contract is deliberately the same as the card and account searches: `results`, `total`, `page`, `limit`.

export interface PagedQuery {
  page?: number;
  limit?: number;
}

export async function pagedFind<T extends Document>(
  collection: Collection<T>,
  filter: Filter<T>,
  query: PagedQuery,
  sort: Record<string, 1 | -1>,
): Promise<Page<T>> {
  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const page = Math.max(1, query.page ?? 1);
  const [results, total] = await Promise.all([
    collection.find(filter, { projection: { _id: 0 } })
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    // Counted with the SAME filter, which is the whole point: a total that ignored the filter would make every
    // page control lie the moment anything was filtered.
    collection.countDocuments(filter),
  ]);
  return { results: results as T[], total, page, limit };
}

/** A field that actually exists on the record. See the note on `textFilter` for why this is not a string. */
export type FieldOf<T> = Extract<keyof T, string>;

/** Groups by one field, for the status chips a list shows above itself. */
export async function countBy<T extends Document>(
  collection: Collection<T>, field: FieldOf<T>, filter: Filter<T> = {},
): Promise<Record<string, number>> {
  const rows = await collection.aggregate<{ _id: string; count: number }>([
    { $match: filter },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]).toArray();
  return Object.fromEntries(rows.filter((row) => row._id != null).map((row) => [String(row._id), row.count]));
}

/**
 * A free-text term matched over the plaintext fields a caller names.
 *
 * The term is treated as a LITERAL: a reference containing a dot should find that reference, and a caller
 * pasting `.*` should find nothing rather than everything.
 *
 * The fields are typed against the record on purpose. A misspelled field name in a `$or` is not an error to
 * MongoDB, it is a clause that matches nothing, so the search box would keep working and keep finding less
 * than it should. Three of these were wrong when this helper took a plain string.
 */
export function textFilter<T extends Document>(term: string | undefined, fields: FieldOf<T>[]): Filter<T> {
  const trimmed = term?.trim();
  if (!trimmed) return {};
  const pattern = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return { $or: fields.map((field) => ({ [field]: pattern })) } as Filter<T>;
}

/** An inclusive date window over an ISO timestamp field, for "what happened between these two days". */
export function dateFilter(field: string, from?: string, to?: string): Record<string, unknown> {
  if (!from && !to) return {};
  const range: Record<string, string> = {};
  if (from) range.$gte = from;
  // A caller passing a plain date means the whole of that day, so the end of the window is the end of it. A
  // naive `$lte` on `2026-08-27` would exclude everything that happened during it.
  if (to) range.$lte = /T/.test(to) ? to : `${to}T23:59:59.999Z`;
  return { [field]: range };
}

/** Combines filters, dropping the empty ones so an unfiltered read stays an unfiltered read. */
export function allOf<T extends Document>(...parts: (Filter<T> | Record<string, unknown>)[]): Filter<T> {
  const used = parts.filter((part) => Object.keys(part).length > 0);
  if (used.length === 0) return {};
  if (used.length === 1) return used[0] as Filter<T>;
  return { $and: used } as Filter<T>;
}

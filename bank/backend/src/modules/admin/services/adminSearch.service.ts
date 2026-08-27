import { Db, Filter, Document } from 'mongodb';
import {
  ISSUED_CARD_REGISTRY_COLLECTION, IssuedCardRegistryRecord, IssuedCardStatus,
} from '../../card-issuer/models/cardIssuerVault.model';
import {
  ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord,
} from '../../aspsp/models/accountArrangement.model';
import { ACCOUNT_HOLDER_COLLECTION, AccountHolderControlRecord } from '../../aspsp/models/accountHolder.model';

// The queries behind the bank's administration screens: filtered, searched, paged.
//
// One constraint shapes every search here, and it is worth stating once: the fields that would be the obvious
// thing to search are ENCRYPTED. `accountIban` carries an equality index, so an exact IBAN is findable and a
// partial one is not; `accountHolderName` carries no query index at all, so it cannot be searched even
// exactly. So a text search runs over the plaintext that exists for exactly this purpose: the masked IBAN,
// the alias, the reference. Offering a name search that silently matched nothing would be worse than not
// offering one.

const MAX_LIMIT = 100;

export interface Page<T> {
  results: T[];
  total: number;
  page: number;
  limit: number;
}

function paging(input: { page?: number; limit?: number }): { skip: number; limit: number; page: number } {
  const limit = Math.min(Math.max(1, input.limit ?? 20), MAX_LIMIT);
  const page = Math.max(1, input.page ?? 1);
  return { skip: (page - 1) * limit, limit, page };
}

// A search term is matched as a literal, not as a pattern: a caller pasting a reference with a `.` in it
// should find that reference, and a caller pasting `.*` should find nothing rather than everything.
function literalRegex(term: string): RegExp {
  return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

// ── Cards ────────────────────────────────────────────────────────────────────────────────────────

export interface CardQuery {
  status?: string;
  network?: string;
  holder?: string;
  last4?: string;
  bin?: string;
  q?: string;
  page?: number;
  limit?: number;
}

// The SAME shape the single-card read returns. A list that answered in the storage field names while the
// detail answered in the view's would make every screen carry two mappings, and the one that renders the raw
// record shows empty cells for every field it did not know about, which is how this was found.
export interface IssuedCardView {
  cardToken: string;
  network: string;
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

function toCardView(record: IssuedCardRegistryRecord): IssuedCardView {
  return {
    cardToken: record.paymentCardReference,
    network: record.paymentCardNetwork,
    bin: record.paymentCardBin,
    lastFour: record.paymentCardLastFour,
    maskedDisplay: record.paymentCardMaskedDisplay,
    status: record.issuedCardStatus,
    expiryMonth: record.paymentCardExpiryMonth,
    expiryYear: record.paymentCardExpiryYear,
    limits: record.issuedCardLimits,
    holderReference: record.accountHolderInstanceReference,
    fundingAccountReference: record.accountArrangementInstanceReference,
  };
}

export async function searchIssuedCards(db: Db, query: CardQuery): Promise<Page<IssuedCardView>> {
  const { skip, limit, page } = paging(query);
  const filter: Filter<IssuedCardRegistryRecord> = {};

  if (query.status) filter.issuedCardStatus = query.status as IssuedCardStatus;
  if (query.network) filter.paymentCardNetwork = query.network.toUpperCase();
  if (query.holder) filter.accountHolderInstanceReference = query.holder;
  if (query.last4) filter.paymentCardLastFour = query.last4;
  // A BIN is a PREFIX by definition, so it is matched as one rather than exactly: an operator holding six
  // digits of an eight-digit BIN still finds the cards.
  if (query.bin) filter.paymentCardBin = { $regex: new RegExp(`^${query.bin.replace(/\D/g, '')}`) };

  if (query.q?.trim()) {
    const term = literalRegex(query.q.trim());
    // Every field here is non-sensitive by construction: a token is a surrogate, the last four and the BIN
    // are what may be displayed, and the masked display is derived from them.
    filter.$or = [
      { paymentCardReference: term },
      { paymentCardLastFour: term },
      { paymentCardBin: term },
      { paymentCardMaskedDisplay: term },
      { accountHolderInstanceReference: term },
    ];
  }

  const collection = db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION);
  const [results, total] = await Promise.all([
    collection.find(filter, { projection: { _id: 0 } })
      .sort({ recordCreatedDateTime: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);
  return { results: results.map(toCardView), total, page, limit };
}

export async function countCardsByStatus(db: Db): Promise<Record<string, number>> {
  const rows = await db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION)
    .aggregate<{ _id: string; count: number }>([{ $group: { _id: '$issuedCardStatus', count: { $sum: 1 } } }])
    .toArray();
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}

// ── Accounts ─────────────────────────────────────────────────────────────────────────────────────

export interface AccountQuery {
  status?: string;
  kind?: string;
  currency?: string;
  holder?: string;
  q?: string;
  page?: number;
  limit?: number;
}

// What an administration screen may see. The IBAN is deliberately NOT here: it is encrypted personal data,
// and the masked form is what a list needs. A screen that wants the full value asks for one account.
export interface AccountAdminView {
  accountArrangementInstanceReference: string;
  accountHolderInstanceReference: string;
  accountHolderName?: string;
  accountKind: string;
  accountStatus: string;
  accountAlias?: string;
  accountCurrency: string;
  accountCountryCode: string;
  accountMaskedIban: string;
  accountBic: string;
  availableAmount: number;
  reservedAmount: number;
  accountOpenedDateTime: string;
}

export async function searchAccounts(db: Db, query: AccountQuery): Promise<Page<AccountAdminView>> {
  const { skip, limit, page } = paging(query);
  const filter: Filter<AccountArrangementControlRecord> = {};

  if (query.status) filter.accountStatus = query.status as AccountArrangementControlRecord['accountStatus'];
  if (query.kind) filter.accountKind = query.kind as AccountArrangementControlRecord['accountKind'];
  if (query.currency) filter.accountCurrency = query.currency.toUpperCase();
  if (query.holder) filter.accountHolderInstanceReference = query.holder;

  if (query.q?.trim()) {
    const raw = query.q.trim();
    const term = literalRegex(raw);
    const or: Filter<AccountArrangementControlRecord>[] = [
      { accountArrangementInstanceReference: term },
      { accountAlias: term },
      { accountMaskedIban: term },
      { accountBic: term },
      { accountHolderInstanceReference: term },
    ];
    // An IBAN can only be matched EXACTLY, because the stored field is encrypted with an equality index.
    // A partial IBAN is not searchable and is not pretended to be: the masked form above covers the last
    // four, which is what an operator reading a statement actually has.
    if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i.test(raw)) or.push({ accountIban: raw.toUpperCase() });
    filter.$or = or;
  }

  const collection = db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION);
  const [records, total] = await Promise.all([
    collection.find(filter, { projection: { _id: 0 } })
      .sort({ accountOpenedDateTime: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  // The holder's name comes from its own record. Resolved per page rather than joined: `$lookup` is not
  // available over an encrypted collection, which is the same reason the rest of this service reads twice.
  const holderRefs = [...new Set(records.map((r) => r.accountHolderInstanceReference))];
  const holders = holderRefs.length
    ? await db.collection<AccountHolderControlRecord>(ACCOUNT_HOLDER_COLLECTION)
      .find({ accountHolderInstanceReference: { $in: holderRefs } }, { projection: { _id: 0 } })
      .toArray()
    : [];
  const nameByRef = new Map(holders.map((h) => [h.accountHolderInstanceReference, h.accountHolderName]));

  return {
    results: records.map((record) => ({
      accountArrangementInstanceReference: record.accountArrangementInstanceReference,
      accountHolderInstanceReference: record.accountHolderInstanceReference,
      accountHolderName: nameByRef.get(record.accountHolderInstanceReference),
      accountKind: record.accountKind,
      accountStatus: record.accountStatus,
      accountAlias: record.accountAlias,
      accountCurrency: record.accountCurrency,
      accountCountryCode: record.accountCountryCode,
      accountMaskedIban: record.accountMaskedIban,
      accountBic: record.accountBic,
      availableAmount: record.accountBalance?.availableAmount ?? 0,
      reservedAmount: record.accountBalance?.reservedAmount ?? 0,
      accountOpenedDateTime: record.accountOpenedDateTime,
    })),
    total,
    page,
    limit,
  };
}

export async function countAccountsByStatus(db: Db): Promise<Record<string, number>> {
  const rows = await db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION)
    .aggregate<{ _id: string; count: number }>([{ $group: { _id: '$accountStatus', count: { $sum: 1 } } }] as Document[])
    .toArray();
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}

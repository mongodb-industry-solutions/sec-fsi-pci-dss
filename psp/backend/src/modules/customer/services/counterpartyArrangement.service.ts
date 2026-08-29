// Counterparty Administration, beneficiary registry service
// Beneficiaries are located by QE equality search on the party collection (phone / email).
// Raw PII is NEVER stored, only the resolved partyInstanceReference and a masked hint.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  COUNTERPARTY_COLLECTION,
  COUNTERPARTY_MAX_PER_USER,
  CounterpartyArrangement,
  CounterpartyArrangementStatus,
  CounterpartyLookupType,
  maskLookupValue,
} from '../models/counterpartyArrangement.model';
import { PARTY_COLLECTION, PartyControlRecord } from '../../identity/models/party.model';
import { getDbForRole } from '../../../vendors/encryption/roleClients';

export interface RegisterBeneficiaryInput {
  ownerPartyReference: string;
  lookupType: CounterpartyLookupType;
  lookupValue: string;           // raw phone or email, used for QE equality search only, NEVER stored
  label?: string;
}

export interface BeneficiaryLookupResult {
  found: boolean;
  isDuplicate?: boolean;
  counterpartyArrangementReference?: string;
  counterpartyLabel?: string;
  counterpartyLookupHint?: string;
}

/**
 * Resolve a phone or email to a partyInstanceReference using QE equality search.
 * Returns null if no party found (anti-enumeration: caller should return found:false).
 */
async function resolvePartyByLookup(
  lookupType: CounterpartyLookupType,
  lookupValue: string,
): Promise<PartyControlRecord | null> {
  // QE equality search requires the L1 QE client (phone/email are QE:equality, L1+)
  const qeDb = await getDbForRole('level1_analyst', false);
  const field = lookupType === 'phone' ? 'partyMobilePhoneNumber' : 'partyEmailAddress';
  return qeDb.collection<PartyControlRecord>(PARTY_COLLECTION).findOne({ [field]: lookupValue });
}

export async function registerBeneficiary(
  db: Db,
  input: RegisterBeneficiaryInput,
): Promise<BeneficiaryLookupResult> {
  const col = db.collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION);

  // QE equality search: resolve raw phone/email to a party reference
  const counterpartyParty = await resolvePartyByLookup(input.lookupType, input.lookupValue);

  // Anti-enumeration: treat not-found and already-registered the same way to a caller
  if (!counterpartyParty) {
    return { found: false };
  }

  // Cannot add yourself as a beneficiary
  if (counterpartyParty.partyInstanceReference === input.ownerPartyReference) {
    return { found: false };
  }

  const maskedHint = maskLookupValue(input.lookupType, input.lookupValue);
  const label = input.label?.trim() || maskedHint;
  const now = new Date();

  // Check for an existing arrangement (any status) for this (owner, counterparty) pair.
  // The unique index on (ownerPartyReference, counterpartyPartyReference) covers soft-deleted
  // records too, so a plain insert would collide. Reactivate a removed one instead.
  const existing = await col.findOne({
    ownerPartyReference: input.ownerPartyReference,
    counterpartyPartyReference: counterpartyParty.partyInstanceReference,
  });
  if (existing && existing.counterpartyArrangementStatus === 'active') {
    // Return found:false to prevent confirmation of existing relationship (anti-enumeration).
    // Checked before the limit so an at-limit re-add stays idempotent instead of leaking a 422.
    return { found: false };
  }

  // Enforce max beneficiary limit only on paths that add an active arrangement
  // (fresh insert or reactivation of a soft-deleted one).
  const count = await col.countDocuments({
    ownerPartyReference: input.ownerPartyReference,
    counterpartyArrangementStatus: 'active',
  });
  if (count >= COUNTERPARTY_MAX_PER_USER) {
    throw Object.assign(new Error('Beneficiary limit reached'), { statusCode: 422 });
  }

  if (existing) {
    // Reactivate the soft-deleted arrangement, refreshing label/hint/type.
    const res = await col.updateOne(
      {
        counterpartyArrangementReference: existing.counterpartyArrangementReference,
        ownerPartyReference: input.ownerPartyReference,
        counterpartyArrangementStatus: existing.counterpartyArrangementStatus,
      },
      {
        $set: {
          counterpartyArrangementStatus: 'active',
          counterpartyLabel: label,
          counterpartyLookupType: input.lookupType,
          counterpartyLookupHint: maskedHint,
          recordUpdatedDateTime: now,
        },
      },
    );
    // If the record changed status between findOne and updateOne (concurrent reactivation),
    // the filter no longer matches. Treat it like an already-active arrangement (anti-enumeration)
    // rather than reporting a reactivation that did not actually happen.
    if (res.modifiedCount !== 1) {
      return { found: false };
    }
    return {
      found: true,
      counterpartyArrangementReference: existing.counterpartyArrangementReference,
      counterpartyLabel: label,
      counterpartyLookupHint: maskedHint,
    };
  }

  const record: CounterpartyArrangement = {
    counterpartyArrangementReference: uuidv4(),
    ownerPartyReference: input.ownerPartyReference,
    counterpartyPartyReference: counterpartyParty.partyInstanceReference,
    counterpartyLabel: label,
    counterpartyLookupType: input.lookupType,
    counterpartyLookupHint: maskedHint,
    counterpartyArrangementStatus: 'active',
    bianServiceDomain: 'Counterparty Administration',
    bianControlRecordType: 'CounterpartyArrangement',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };

  await col.insertOne(record);
  return {
    found: true,
    counterpartyArrangementReference: record.counterpartyArrangementReference,
    counterpartyLabel: record.counterpartyLabel,
    counterpartyLookupHint: maskedHint,
  };
}

export async function listBeneficiaries(
  db: Db,
  ownerPartyReference: string,
  opts?: { page?: number; limit?: number },
): Promise<{ results: CounterpartyArrangement[]; total: number }> {
  const query = { ownerPartyReference, counterpartyArrangementStatus: 'active' as const };
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;

  const col = db.collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION);
  const [results, total] = await Promise.all([
    col.find(query).sort({ recordCreatedDateTime: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(query),
  ]);
  return { results, total };
}

export async function removeBeneficiary(
  db: Db,
  ownerPartyReference: string,
  counterpartyArrangementReference: string,
): Promise<boolean> {
  const result = await db.collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION).updateOne(
    {
      counterpartyArrangementReference,
      ownerPartyReference,
      counterpartyArrangementStatus: 'active',
    },
    { $set: { counterpartyArrangementStatus: 'removed', recordUpdatedDateTime: new Date() } },
  );
  return result.modifiedCount === 1;
}

/** Sentinel owner reference for a predicate that resolves to no customer: matches no document. */
const NO_MATCH = '__no_such_owner__';

/** Owner party behind an investigation case (case -> agreement -> party). */
async function resolveCaseOwner(db: Db, caseRef: string): Promise<string | undefined> {
  const [{ FRAUD_DIAGNOSIS_COLLECTION }, { CUSTOMER_AGREEMENT_COLLECTION }] = await Promise.all([
    import('../../fraud/models/fraudDiagnosis.model'),
    import('../../customer/models/customerAgreement.model'),
  ]);
  const kase = await db.collection<{ customerAgreementInstanceReference?: string }>(FRAUD_DIAGNOSIS_COLLECTION)
    .findOne(
      { $or: [{ fraudDiagnosisCaseReference: caseRef }, { fraudDiagnosisInstanceReference: caseRef }] },
      { projection: { customerAgreementInstanceReference: 1 } },
    );
  if (!kase?.customerAgreementInstanceReference) return undefined;
  const agreement = await db.collection<{ partyInstanceReference?: string }>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne(
      { customerAgreementInstanceReference: kase.customerAgreementInstanceReference },
      { projection: { partyInstanceReference: 1 } },
    );
  return agreement?.partyInstanceReference;
}

/** Minimum length of a free-text beneficiary predicate, aligned with the QE text-search minimums. */
export const BENEFICIARY_MIN_QUERY_LENGTH = 3;

/** Thrown when a staff caller asks for beneficiaries without a discriminating predicate. */
export class PredicateRequiredError extends Error {
  readonly statusCode = 400;
  constructor(message: string) { super(message); this.name = 'PredicateRequiredError'; }
}

/**
 * Requires a discriminating predicate for a cross-party read: an owner party reference, a case
 * reference, or a search term of at least BENEFICIARY_MIN_QUERY_LENGTH. ADR-048.
 */
export function assertBeneficiaryPredicate(opts?: {
  ownerRef?: string; q?: string; caseRef?: string;
}): void {
  if (opts?.ownerRef) return;
  if (opts?.caseRef) return;
  const q = (opts?.q ?? '').trim();
  if (q.length >= BENEFICIARY_MIN_QUERY_LENGTH) return;
  throw new PredicateRequiredError(
    'A discriminating predicate is required: provide an owner party reference, a case reference, or a '
    + `search term of at least ${BENEFICIARY_MIN_QUERY_LENGTH} characters.`,
  );
}

// Staff-facing beneficiary search. A predicate is mandatory.
export async function listAllBeneficiaries(
  db: Db,
  opts?: {
    ownerRef?: string;
    q?: string;
    caseRef?: string;
    status?: CounterpartyArrangementStatus;
    page?: number;
    limit?: number;
    /** Own-scope callers (customer) are already pinned to their own ownerRef by the caller. */
    skipPredicateCheck?: boolean;
  },
): Promise<{ results: CounterpartyArrangement[]; total: number }> {
  // Normalize before anything else, so the predicate check and the query can never disagree about
  // what counts as supplied. A blank hint is absent, not a value: left as-is, a caller passing
  // ownerRef='' with a caseRef would clear the case scope (`'' ?? x` keeps '') yet still pass the
  // check, turning a case-scoped read into an unscoped one (the enumeration ADR-048 forbids).
  const ownerHint = opts?.ownerRef?.trim() || undefined;
  const caseHint = opts?.caseRef?.trim() || undefined;
  const qHint = opts?.q?.trim() || undefined;
  if (!opts?.skipPredicateCheck) assertBeneficiaryPredicate({ ownerRef: ownerHint, caseRef: caseHint, q: qHint });
  const query: Record<string, unknown> = {};
  // A case reference is a predicate only because it identifies ONE customer: resolve it to that
  // party and scope the read, otherwise it would satisfy the check while returning the whole
  // collection. An unresolvable case matches nothing.
  const ownerRef = ownerHint ?? (caseHint ? await resolveCaseOwner(db, caseHint) ?? NO_MATCH : undefined);
  if (ownerRef) query.ownerPartyReference = ownerRef;
  query.counterpartyArrangementStatus = opts?.status ?? 'active';
  if (qHint) {
    const safe = qHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(safe, 'i');
    query.$or = [
      { counterpartyLabel: { $regex: re } },
      { counterpartyLookupHint: { $regex: re } },
    ];
  }

  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
  const skip = (page - 1) * limit;
  const col = db.collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION);
  const [results, total] = await Promise.all([
    col.find(query as Parameters<typeof col.find>[0]).sort({ recordCreatedDateTime: -1 }).skip(skip).limit(limit).toArray(),
    col.countDocuments(query as Parameters<typeof col.countDocuments>[0]),
  ]);
  return { results, total };
}

export async function getOneBeneficiary(
  db: Db,
  counterpartyArrangementReference: string,
): Promise<CounterpartyArrangement | null> {
  return db
    .collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION)
    .findOne({ counterpartyArrangementReference }, { projection: { _id: 0 } });
}

export async function updateBeneficiaryLabel(
  db: Db,
  counterpartyArrangementReference: string,
  newLabel: string,
): Promise<CounterpartyArrangement | null> {
  const col = db.collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION);
  await col.updateOne(
    { counterpartyArrangementReference, counterpartyArrangementStatus: 'active' },
    { $set: { counterpartyLabel: newLabel.trim(), recordUpdatedDateTime: new Date() } },
  );
  return col.findOne({ counterpartyArrangementReference }, { projection: { _id: 0 } });
}

/** Aggregate beneficiary metrics with no identifiers. ADR-048. */
export async function getBeneficiaryAggregates(
  db: Db,
): Promise<{ total: number; byStatus: Record<string, number>; byLookupType: Record<string, number> }> {
  const col = db.collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION);
  const [byStatus, byLookupType, total] = await Promise.all([
    col.aggregate([{ $group: { _id: '$counterpartyArrangementStatus', n: { $sum: 1 } } }]).toArray(),
    col.aggregate([{ $group: { _id: '$counterpartyLookupType', n: { $sum: 1 } } }]).toArray(),
    col.countDocuments({}),
  ]);
  const toMap = (rows: Array<Record<string, unknown>>) => Object.fromEntries(
    rows.map((r) => [String(r._id ?? 'unknown'), Number(r.n ?? 0)]),
  );
  return { total, byStatus: toMap(byStatus), byLookupType: toMap(byLookupType) };
}

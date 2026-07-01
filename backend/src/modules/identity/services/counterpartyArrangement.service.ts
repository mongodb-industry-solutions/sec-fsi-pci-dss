// BIAN SD-54: Counterparty Administration — beneficiary registry service
// Beneficiaries are located by QE equality search on the party collection (phone / email).
// Raw PII is NEVER stored — only the resolved partyInstanceReference and a masked hint.

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  COUNTERPARTY_COLLECTION,
  COUNTERPARTY_MAX_PER_USER,
  CounterpartyArrangement,
  CounterpartyLookupType,
  maskLookupValue,
} from '../models/counterpartyArrangement.model';
import { PARTY_COLLECTION, PartyControlRecord } from '../models/party.model';
import { getDbForRole } from '../../../vendors/encryption/roleClients';

export interface RegisterBeneficiaryInput {
  ownerPartyReference: string;
  lookupType: CounterpartyLookupType;
  lookupValue: string;           // raw phone or email — used for QE equality search only, NEVER stored
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

  // Enforce max beneficiary limit
  const count = await col.countDocuments({
    ownerPartyReference: input.ownerPartyReference,
    counterpartyArrangementStatus: 'active',
  });
  if (count >= COUNTERPARTY_MAX_PER_USER) {
    throw Object.assign(new Error('Beneficiary limit reached'), { statusCode: 422 });
  }

  // QE equality search — resolve raw phone/email to a party reference
  const counterpartyParty = await resolvePartyByLookup(input.lookupType, input.lookupValue);

  // Anti-enumeration: treat not-found and already-registered the same way to a caller
  if (!counterpartyParty) {
    return { found: false };
  }

  // Cannot add yourself as a beneficiary
  if (counterpartyParty.partyInstanceReference === input.ownerPartyReference) {
    return { found: false };
  }

  // Check for duplicate (owner already has this party as beneficiary)
  const existing = await col.findOne({
    ownerPartyReference: input.ownerPartyReference,
    counterpartyPartyReference: counterpartyParty.partyInstanceReference,
    counterpartyArrangementStatus: 'active',
  });
  if (existing) {
    // Return found:false to prevent confirmation of existing relationship (anti-enumeration)
    return { found: false };
  }

  const maskedHint = maskLookupValue(input.lookupType, input.lookupValue);
  const label = input.label?.trim() || maskedHint;
  const now = new Date();

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

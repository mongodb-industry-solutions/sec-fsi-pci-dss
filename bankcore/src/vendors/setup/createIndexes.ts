import { Db, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { BANK_PROFILE_COLLECTION } from '../../modules/aspsp/models/bankProfile.model';
import { DOMAIN_EVENT_COLLECTION } from '@leafypay/eventbus';
import { COUNTERS_COLLECTION, IDEMPOTENCY_COLLECTION } from './createCollections';

interface IndexPlan {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions;
}

const INDEXES: IndexPlan[] = [
  {
    collection: BANK_PROFILE_COLLECTION,
    keys: { bankProfileInstanceReference: 1 },
    options: { unique: true, name: 'bankProfile_ref_unique' },
  },
  // Routing lookups: which bank owns this BIC, this IBAN bank code, this BIN.
  {
    collection: BANK_PROFILE_COLLECTION,
    keys: { bankProfileBic: 1 },
    options: { unique: true, name: 'bankProfile_bic_unique' },
  },
  {
    collection: BANK_PROFILE_COLLECTION,
    keys: { bankProfileIbanBankCodes: 1 },
    options: { name: 'bankProfile_iban_bank_codes' },
  },
  {
    collection: BANK_PROFILE_COLLECTION,
    keys: { 'bankProfileBinRanges.binRangeFrom': 1, 'bankProfileBinRanges.binRangeTo': 1 },
    options: { name: 'bankProfile_bin_ranges' },
  },
  // The event store: idempotent append plus correlated replay of a whole journey.
  {
    collection: DOMAIN_EVENT_COLLECTION,
    keys: { eventId: 1 },
    options: { unique: true, name: 'domainEvent_eventId_unique' },
  },
  {
    collection: DOMAIN_EVENT_COLLECTION,
    keys: { correlationId: 1, occurredAt: 1 },
    options: { name: 'domainEvent_correlation_time' },
  },
  {
    collection: DOMAIN_EVENT_COLLECTION,
    keys: { businessProcess: 1, occurredAt: -1 },
    options: { name: 'domainEvent_process_time' },
  },
  {
    collection: COUNTERS_COLLECTION,
    keys: { counterName: 1 },
    options: { unique: true, name: 'counters_name_unique' },
  },
  // Replaying a retried write must find the original result, and stale keys must age out.
  {
    collection: IDEMPOTENCY_COLLECTION,
    keys: { idempotencyKeyValue: 1 },
    options: { unique: true, name: 'idempotencyKey_value_unique' },
  },
  {
    collection: IDEMPOTENCY_COLLECTION,
    keys: { recordCreatedDateTime: 1 },
    options: { name: 'idempotencyKey_ttl', expireAfterSeconds: 86400 },
  },
];

export async function createIndexes(db: Db): Promise<void> {
  for (const { collection, keys, options } of INDEXES) {
    await db.collection(collection).createIndex(keys, options);
    console.log(`  index:   ${collection}.${options.name}`);
  }
}

export function plannedIndexes(): IndexPlan[] {
  return INDEXES;
}

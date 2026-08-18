import { Db, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import { BANK_PROFILE_COLLECTION } from '../../modules/aspsp/models/bankProfile.model';
import { DOMAIN_EVENT_COLLECTION } from '@leafypay/eventbus';
import { ACCOUNT_ARRANGEMENT_COLLECTION } from '../../modules/aspsp/models/accountArrangement.model';
import { ACCOUNT_HOLDER_COLLECTION } from '../../modules/aspsp/models/accountHolder.model';
import { ACCOUNT_MOVEMENT_COLLECTION } from '../../modules/aspsp/models/accountMovement.model';
import { BALANCE_CREDIT_LOG_COLLECTION } from '../../modules/aspsp/models/balanceCreditLog.model';
import { TPP_REGISTRATION_COLLECTION } from '../../modules/tpp-trust/models/tppRegistration.model';
import { BANK_CONSENT_AGREEMENT_COLLECTION, BANK_CONSENT_ACCESS_LOG_COLLECTION } from '../../modules/consent/models/bankConsent.model';
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
  // The ledger. Every balance mutation filters on the account reference plus an active status, so
  // that pair is the index the conditional updates ride on.
  {
    collection: ACCOUNT_ARRANGEMENT_COLLECTION,
    keys: { accountArrangementInstanceReference: 1 },
    options: { unique: true, name: 'accountArrangement_ref_unique' },
  },
  {
    collection: ACCOUNT_ARRANGEMENT_COLLECTION,
    keys: { accountHolderInstanceReference: 1, accountStatus: 1 },
    options: { name: 'accountArrangement_holder_status' },
  },
  {
    collection: ACCOUNT_HOLDER_COLLECTION,
    keys: { accountHolderInstanceReference: 1 },
    options: { unique: true, name: 'accountHolder_ref_unique' },
  },
  // A statement is "this account, newest first", which is exactly this index.
  {
    collection: ACCOUNT_MOVEMENT_COLLECTION,
    keys: { accountArrangementInstanceReference: 1, movementValueDateTime: -1 },
    options: { name: 'accountMovement_account_time' },
  },
  {
    collection: ACCOUNT_MOVEMENT_COLLECTION,
    keys: { movementCorrelationId: 1 },
    options: { name: 'accountMovement_correlation' },
  },
  {
    collection: BALANCE_CREDIT_LOG_COLLECTION,
    keys: { accountArrangementInstanceReference: 1, recordCreatedDateTime: -1 },
    options: { name: 'balanceCreditLog_account_time' },
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
  // Every token request looks a client up by its id, so that lookup is unique and indexed.
  {
    collection: TPP_REGISTRATION_COLLECTION,
    keys: { tppRegistrationClientId: 1 },
    options: { unique: true, name: 'tppRegistration_client_id_unique' },
  },
  {
    collection: TPP_REGISTRATION_COLLECTION,
    keys: { tppRegistrationInstanceReference: 1 },
    options: { unique: true, name: 'tppRegistration_ref_unique' },
  },
  // Every consent-bearing call resolves the consent by its id AND its owner, so that pair is the index
  // the enforcement path rides on.
  {
    collection: BANK_CONSENT_AGREEMENT_COLLECTION,
    keys: { bankConsentAgreementInstanceReference: 1 },
    options: { unique: true, name: 'bankConsent_ref_unique' },
  },
  {
    collection: BANK_CONSENT_AGREEMENT_COLLECTION,
    keys: { bankConsentTppClientId: 1, bankConsentAccountHolderInstanceReference: 1, bankConsentStatus: 1 },
    options: { name: 'bankConsent_tpp_holder_status' },
  },
  // The evidence query is "what did this TPP do under this consent", newest first.
  {
    collection: BANK_CONSENT_ACCESS_LOG_COLLECTION,
    keys: { bankConsentAgreementInstanceReference: 1, recordCreatedDateTime: -1 },
    options: { name: 'bankConsentAccessLog_consent_time' },
  },
  {
    collection: BANK_CONSENT_ACCESS_LOG_COLLECTION,
    keys: { accessCorrelationId: 1 },
    options: { name: 'bankConsentAccessLog_correlation' },
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

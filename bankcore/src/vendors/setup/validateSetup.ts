import { Db } from 'mongodb';
import { BANK_PROFILE_COLLECTION, BankProfileControlRecord } from '../../modules/aspsp/models/bankProfile.model';
import { DOMAIN_EVENT_COLLECTION } from '@leafypay/eventbus';
import { ACCOUNT_ARRANGEMENT_COLLECTION } from '../../modules/aspsp/models/accountArrangement.model';
import { ACCOUNT_HOLDER_COLLECTION } from '../../modules/aspsp/models/accountHolder.model';
import { ACCOUNT_MOVEMENT_COLLECTION } from '../../modules/aspsp/models/accountMovement.model';
import { BALANCE_CREDIT_LOG_COLLECTION } from '../../modules/aspsp/models/balanceCreditLog.model';
import { TPP_REGISTRATION_COLLECTION, TppRegistrationControlRecord } from '../../modules/tpp-trust/models/tppRegistration.model';
import {
  BANK_CONSENT_AGREEMENT_COLLECTION, BANK_CONSENT_ACCESS_LOG_COLLECTION, BankConsentAgreementControlRecord,
} from '../../modules/consent/models/bankConsent.model';
import { PAYMENT_INITIATION_COLLECTION } from '../../modules/pisp/models/paymentInitiation.model';
import { COUNTERS_COLLECTION, IDEMPOTENCY_COLLECTION } from './createCollections';
import { plannedIndexes } from './createIndexes';
import { assertCryptSharedLib } from '../encryption/qeClient';
import { findOrphanedDeks } from '../encryption/keyVault';
import { validateCrossSide } from './validateCrossSide';
import { assertLinks, resolvePlatformLinks } from '@leafypay/platform-links';
import { readSeedFile } from '../seed/readSeedFile';
import { config, keyVaultNamespaceParts } from '../../config';

export interface ValidationResult {
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  ok: boolean;
}

const REQUIRED_COLLECTIONS = [
  BANK_PROFILE_COLLECTION,
  ACCOUNT_ARRANGEMENT_COLLECTION,
  ACCOUNT_HOLDER_COLLECTION,
  ACCOUNT_MOVEMENT_COLLECTION,
  BALANCE_CREDIT_LOG_COLLECTION,
  TPP_REGISTRATION_COLLECTION,
  BANK_CONSENT_AGREEMENT_COLLECTION,
  BANK_CONSENT_ACCESS_LOG_COLLECTION,
  PAYMENT_INITIATION_COLLECTION,
  DOMAIN_EVENT_COLLECTION,
  COUNTERS_COLLECTION,
  IDEMPOTENCY_COLLECTION,
];

// Validates the bank database. Failures here are cheap; the same problems found at runtime look like
// a generic 503 or an opaque timeout, which is what makes them expensive.
export async function validateSetup(db: Db): Promise<ValidationResult> {
  const checks: ValidationResult['checks'] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  try {
    add('crypt_shared library', true, assertCryptSharedLib());
  } catch (err) {
    add('crypt_shared library', false, err instanceof Error ? err.message : String(err));
  }

  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const name of REQUIRED_COLLECTIONS) {
    add(`collection ${name}`, existing.has(name), existing.has(name) ? undefined : 'missing');
  }

  for (const plan of plannedIndexes()) {
    if (!existing.has(plan.collection)) {
      add(`index ${plan.collection}.${plan.options.name}`, false, 'collection missing');
      continue;
    }
    const names = (await db.collection(plan.collection).indexes()).map((i) => i.name);
    const ok = names.includes(plan.options.name as string);
    add(`index ${plan.collection}.${plan.options.name}`, ok, ok ? undefined : 'missing');
  }

  // The shared key vault must be reachable and must already hold the PSP DEKs: an empty one means
  // bankcore is pointed at a key vault of its own, which defeats the shared-DEK decision.
  const { database, collection } = keyVaultNamespaceParts();
  try {
    const dekCount = await db.client.db(database).collection(collection).countDocuments();
    add(`key vault ${config.kms.keyVaultNamespace}`, dekCount > 0, `${dekCount} DEK(s)`);
  } catch (err) {
    add(`key vault ${config.kms.keyVaultNamespace}`, false, err instanceof Error ? err.message : String(err));
  }

  // A bank with no profile is unroutable: nothing can decide that an IBAN or a PAN belongs to it.
  const profiles = await db.collection<BankProfileControlRecord>(BANK_PROFILE_COLLECTION)
    .find({}, { projection: { _id: 0, bankProfileBic: 1, bankProfileIbanBankCodes: 1, bankProfileBinRanges: 1 } })
    .toArray()
    .catch(() => []);
  add('bankProfile seeded', profiles.length > 0, `${profiles.length} profile(s)`);
  for (const profile of profiles) {
    const routable = Boolean(profile.bankProfileBic)
      && (profile.bankProfileIbanBankCodes?.length > 0 || profile.bankProfileBinRanges?.length > 0);
    add(`bankProfile ${profile.bankProfileBic ?? '(no BIC)'} routable`, routable,
      routable ? undefined : 'needs a BIC plus at least one IBAN bank code or BIN range');
  }

  // The ledger must be encrypted where it holds personal data: an accountArrangement created without
  // its encryptedFields would store IBANs in clear and no read would ever complain.
  for (const name of [ACCOUNT_ARRANGEMENT_COLLECTION, ACCOUNT_HOLDER_COLLECTION]) {
    const info = existing.has(name)
      ? (await db.listCollections({ name }).toArray())[0] as { options?: { encryptedFields?: { fields?: unknown[] } } } | undefined
      : undefined;
    const fields = info?.options?.encryptedFields?.fields?.length ?? 0;
    add(`QE on ${name}`, fields > 0, fields > 0 ? `${fields} encrypted field(s)` : 'no encryptedFields; needs --reset');
  }

  // Same condition the setup refuses to run against: DEK references that outlived their key vault.
  try {
    const orphans = await findOrphanedDeks(db.client, config.mongodb.dbName);
    add('DEK references resolve in the shared key vault', orphans.length === 0,
      orphans.length === 0 ? undefined : `stale in: ${orphans.join(', ')}; rebuild with setup:db:reset`);
  } catch (err) {
    add('DEK references resolve in the shared key vault', false, err instanceof Error ? err.message : String(err));
  }

  // Without an active TPP holding a secret hash, no caller can obtain a token and the whole API is
  // closed. That is a fresh-deploy failure worth catching at setup, not on the first read.
  const registrations = await db.collection<TppRegistrationControlRecord>(TPP_REGISTRATION_COLLECTION)
    .find({ tppRegistrationStatus: 'active' }, { projection: { _id: 0, tppRegistrationClientId: 1, tppRegistrationClientSecretHash: 1, tppRegistrationRoles: 1, tppRegistrationGrantedScopes: 1 } })
    .toArray()
    .catch(() => []);
  add('tppRegistration seeded and active', registrations.length > 0, `${registrations.length} active TPP(s)`);
  for (const registration of registrations) {
    const usable = registration.tppRegistrationClientSecretHash?.startsWith('$2')
      && registration.tppRegistrationRoles?.length > 0
      && registration.tppRegistrationGrantedScopes?.length > 0;
    add(`TPP ${registration.tppRegistrationClientId} can authenticate`, Boolean(usable),
      usable ? undefined : 'needs a bcrypt secret hash, at least one role and at least one scope');
  }

  // The SEEDED consents must be usable, or every read fails closed and the demo shows stale balances
  // with no obvious cause.
  //
  // Scoped to the fixture on purpose: a consent created at RUNTIME may legitimately be terminated,
  // revoked or expired, and judging every record in the collection would make this check fail as soon as
  // someone exercises the lifecycle. Found exactly that way, by terminating one while testing.
  const seededConsentRefs = new Set(
    readSeedFile<Array<{ bankConsentAgreementInstanceReference: string }>>('consents.json')
      .map((record) => record.bankConsentAgreementInstanceReference),
  );
  const consents = (await db.collection<BankConsentAgreementControlRecord>(BANK_CONSENT_AGREEMENT_COLLECTION)
    .find({}, { projection: { _id: 0, bankConsentAgreementInstanceReference: 1, bankConsentStatus: 1, bankConsentAccess: 1, bankConsentValidUntil: 1 } })
    .toArray()
    .catch(() => []))
    .filter((consent) => seededConsentRefs.has(consent.bankConsentAgreementInstanceReference));

  const valid = consents.filter((consent) => consent.bankConsentStatus === 'valid');
  add('every seeded consent is present and valid',
    consents.length === seededConsentRefs.size && valid.length === consents.length,
    `${valid.length} valid of ${seededConsentRefs.size} seeded`);
  const notYetLapsed = valid.every((consent) => new Date(`${consent.bankConsentValidUntil.slice(0, 10)}T23:59:59Z`) > new Date());
  add('every seeded consent is still within its validity', consents.length === 0 || notYetLapsed,
    notYetLapsed ? undefined : 'a seeded consent has already expired, so reads fail closed');
  const covering = valid.filter((consent) => (consent.bankConsentAccess?.accounts ?? []).length > 0);
  add('every seeded consent covers at least one account', valid.length === covering.length,
    valid.length === covering.length ? undefined : 'a consent granting nothing is unusable');
  // Payment access is derived from the account list, so a consent that grants accounts but no payments
  // came from an older seed and would refuse every initiation with a consent error.
  const withPayments = valid.filter((consent) => (consent.bankConsentAccess?.payments ?? []).length > 0);
  add('every seeded consent authorises payments from its accounts', valid.length === withPayments.length,
    valid.length === withPayments.length ? undefined : 're-seed: the consent predates payment access');

  // Cross side: the PSP's linked accounts must resolve to real accounts here, and every seeded IBAN
  // must be one this bank actually owns.
  for (const check of await validateCrossSide(db)) add(check.name, check.ok, check.detail);

  // Links: absolute, well formed, and of the right kind for their consumer. A wrong host fails as an
  // opaque timeout or a generic 503, the same failure mode as a bad crypt_shared path.
  const links = resolvePlatformLinks();
  for (const check of assertLinks([
    { name: 'link bankcore base URL (private)', value: links.bankcoreBaseUrl, expected: 'private' },
    { name: 'link PSP callback host (private)', value: links.pspBaseUrl, expected: 'private' },
  ])) {
    add(check.name, check.ok, check.detail);
  }

  return { checks, ok: checks.every((c) => c.ok) };
}

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
import { PERIODIC_PAYMENT_COLLECTION } from '../../modules/pisp/models/periodicPayment.model';
import {
  BANK_MODULE_CONFIGURATION_COLLECTION, BANK_CAPABILITY_KEYS, BankModuleConfigurationControlRecord,
} from '../../modules/admin/models/bankModuleConfiguration.model';
import {
  TPP_EVENT_SUBSCRIPTION_COLLECTION, TPP_WEBHOOK_DELIVERY_LOG_COLLECTION, TppEventSubscriptionControlRecord,
} from '../../modules/tpp-trust/models/tppEventSubscription.model';
import {
  COUNTERPARTY_BANK_COLLECTION, INTERBANK_MESSAGE_LOG_COLLECTION, CounterpartyBankControlRecord,
} from '../../modules/payment-hub/models/counterpartyBank.model';
import { assertLinks as assertSubscriptionLinks } from '@leafypay/platform-links';
import {
  CARD_ISSUER_VAULT_COLLECTION, ISSUED_CARD_REGISTRY_COLLECTION,
} from '../../modules/card-issuer/models/cardIssuerVault.model';
import { CREDIT_ASSESSMENT_COLLECTION } from '../../modules/credit-bureau/models/creditAssessment.model';
import { BANK_AUDIT_LOG_COLLECTION } from '../../modules/audit/models/bankAuditLog.model';
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
  PERIODIC_PAYMENT_COLLECTION,
  BANK_MODULE_CONFIGURATION_COLLECTION,
  TPP_EVENT_SUBSCRIPTION_COLLECTION,
  TPP_WEBHOOK_DELIVERY_LOG_COLLECTION,
  COUNTERPARTY_BANK_COLLECTION,
  INTERBANK_MESSAGE_LOG_COLLECTION,
  CARD_ISSUER_VAULT_COLLECTION,
  ISSUED_CARD_REGISTRY_COLLECTION,
  CREDIT_ASSESSMENT_COLLECTION,
  BANK_AUDIT_LOG_COLLECTION,
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

  // Engine configuration must exist and name a known capability: a record for a capability nothing reads
  // is a setting an operator can change with no effect, which is worse than no setting at all.
  const configs = await db.collection<BankModuleConfigurationControlRecord>(BANK_MODULE_CONFIGURATION_COLLECTION)
    .find({}, { projection: { _id: 0, bankModuleCapability: 1, bankModuleConfiguration: 1 } })
    .toArray()
    .catch(() => []);
  add('bankModuleConfiguration seeded', configs.length > 0, `${configs.length} engine configuration(s)`);
  const unknown = configs.filter((entry) => !BANK_CAPABILITY_KEYS.includes(entry.bankModuleCapability));
  add('every engine configuration names a known capability', unknown.length === 0,
    unknown.length === 0 ? undefined : `unknown: ${unknown.map((e) => e.bankModuleCapability).join(', ')}`);
  // The consent mode is live configuration, so an invalid value would silently fall back and mislead.
  const consentConfig = configs.find((entry) => entry.bankModuleCapability === 'consent');
  const mode = consentConfig?.bankModuleConfiguration?.consentMode;
  add('the consent mode is configured to a valid value', mode === 'automatic' || mode === 'manual',
    `consentMode: ${String(mode)}`);

  // A subscription with no callback, or a relative one, means every notification fails as an opaque
  // unreachable. Checking the shape at setup is far cheaper than finding it when a transfer hangs.
  const subscriptions = await db.collection<TppEventSubscriptionControlRecord>(TPP_EVENT_SUBSCRIPTION_COLLECTION)
    .find({}, { projection: { _id: 0 } })
    .toArray()
    .catch(() => []);
  add('tppEventSubscription seeded', subscriptions.length > 0, `${subscriptions.length} subscription(s)`);
  for (const subscription of subscriptions) {
    for (const check of assertSubscriptionLinks([
      {
        name: `subscription ${subscription.tppRegistrationClientId} callback (private)`,
        value: subscription.tppEventSubscriptionCallbackUrl,
        expected: 'private',
      },
      {
        name: `subscription ${subscription.tppRegistrationClientId} JWKS URL (private)`,
        value: subscription.tppEventSubscriptionJwksUrl,
        expected: 'private',
      },
    ])) {
      add(check.name, check.ok, check.detail);
    }
    const events = subscription.tppEventSubscriptionEventTypes ?? [];
    add(`subscription ${subscription.tppRegistrationClientId} names its events`, events.length > 0,
      events.length > 0 ? events.join(', ') : 'a subscription for nothing delivers nothing');
  }

  // Without a reachability registry every external payment is refused, and the reason ("no registered
  // institution owns that bank code") reads like a bug rather than an unseeded database.
  const counterparties = await db.collection<CounterpartyBankControlRecord>(COUNTERPARTY_BANK_COLLECTION)
    .find({}, { projection: { _id: 0, counterpartyBankName: 1, counterpartyBankSchemes: 1, counterpartyBankStatus: 1 } })
    .toArray()
    .catch(() => []);
  const reachable = counterparties.filter((c) => c.counterpartyBankStatus === 'reachable');
  add('counterpartyBank seeded', counterparties.length > 0,
    `${counterparties.length} institution(s), ${reachable.length} reachable`);
  const schemeless = reachable.filter((c) => (c.counterpartyBankSchemes ?? []).length === 0);
  add('every reachable institution names a scheme', schemeless.length === 0,
    schemeless.length === 0 ? undefined : `no scheme on: ${schemeless.map((c) => c.counterpartyBankName).join(', ')}`);
  // One unreachable entry on purpose: without it the refusal path cannot be demonstrated.
  add('a deliberately unreachable institution exists, so the refusal path is demonstrable',
    counterparties.length > reachable.length,
    counterparties.length > reachable.length ? undefined : 'seed one, or "cannot be paid" is untestable');

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

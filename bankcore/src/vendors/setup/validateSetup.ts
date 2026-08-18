import { Db } from 'mongodb';
import { BANK_PROFILE_COLLECTION, BankProfileControlRecord } from '../../modules/aspsp/models/bankProfile.model';
import { DOMAIN_EVENT_COLLECTION } from '@leafypay/eventbus';
import { ACCOUNT_ARRANGEMENT_COLLECTION } from '../../modules/aspsp/models/accountArrangement.model';
import { ACCOUNT_HOLDER_COLLECTION } from '../../modules/aspsp/models/accountHolder.model';
import { ACCOUNT_MOVEMENT_COLLECTION } from '../../modules/aspsp/models/accountMovement.model';
import { BALANCE_CREDIT_LOG_COLLECTION } from '../../modules/aspsp/models/balanceCreditLog.model';
import { COUNTERS_COLLECTION, IDEMPOTENCY_COLLECTION } from './createCollections';
import { plannedIndexes } from './createIndexes';
import { assertCryptSharedLib } from '../encryption/qeClient';
import { findOrphanedDeks } from '../encryption/keyVault';
import { assertLinks, resolvePlatformLinks } from '@leafypay/platform-links';
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

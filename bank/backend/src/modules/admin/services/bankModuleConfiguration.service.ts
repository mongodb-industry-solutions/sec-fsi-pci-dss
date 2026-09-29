import { Db } from 'mongodb';
import {
  BANK_MODULE_CONFIGURATION_COLLECTION, BANK_CAPABILITY_KEYS,
  BankCapabilityKey, BankModuleConfigurationControlRecord,
} from '../models/bankModuleConfiguration.model';

// Reading and writing the bank's engine configuration. Every engine resolves its own settings through
// `resolveModuleConfig`, which merges the stored document over its defaults, so a missing or partial
// record always yields a working rule set and a fresh database is never unconfigured.

function collection(db: Db) {
  return db.collection<BankModuleConfigurationControlRecord>(BANK_MODULE_CONFIGURATION_COLLECTION);
}

export function isBankCapability(value: string): value is BankCapabilityKey {
  return (BANK_CAPABILITY_KEYS as string[]).includes(value);
}

export async function listModuleConfigurations(db: Db): Promise<BankModuleConfigurationControlRecord[]> {
  return collection(db).find({}, { projection: { _id: 0 } })
    .sort({ bankModuleConfigurationInstanceReference: 1 })
    .toArray();
}

export async function findModuleConfiguration(
  db: Db,
  capability: BankCapabilityKey,
): Promise<BankModuleConfigurationControlRecord | null> {
  return collection(db).findOne(
    { bankModuleConfigurationInstanceReference: capability },
    { projection: { _id: 0 } },
  );
}

/**
 * Merges the stored configuration over an engine's defaults. Shallow on purpose: a nested merge would
 * make it impossible to remove an entry from a list, and every configuration here is a flat set of
 * options plus wholesale-replaced arrays, which is the same contract the PSP's modules already use.
 */
export async function resolveModuleConfig<T extends Record<string, unknown>>(
  db: Db,
  capability: BankCapabilityKey,
  defaults: T,
): Promise<T> {
  const record = await findModuleConfiguration(db, capability).catch(() => null);
  if (!record || record.bankModuleConfigurationStatus !== 'active') return defaults;
  const stored = record.bankModuleConfiguration ?? {};
  const merged = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(stored)) {
    // A key the engine does not know is kept out of its config rather than passed through: an unknown
    // option that silently does nothing is worse than one that was never accepted.
    if (key in defaults && value !== undefined && value !== null) merged[key] = value;
  }
  return merged as T;
}

export type UpdateConfigResult =
  | { ok: true; record: BankModuleConfigurationControlRecord }
  | { ok: false; text: string };

/**
 * Replaces the configuration of one engine. The document is replaced rather than patched, because an
 * operator editing a rule set needs to be able to remove an entry, and a merge cannot express that.
 */
export async function updateModuleConfiguration(
  db: Db,
  capability: BankCapabilityKey,
  configuration: Record<string, unknown>,
  updatedBy?: string,
): Promise<UpdateConfigResult> {
  const existing = await findModuleConfiguration(db, capability);
  if (!existing) {
    // Only seeded capabilities exist: creating one on the fly would let a typo invent an engine whose
    // configuration nothing ever reads.
    return { ok: false, text: `no configuration record for '${capability}'. It is created by the seed.` };
  }
  const now = new Date().toISOString();
  await collection(db).updateOne(
    { bankModuleConfigurationInstanceReference: capability },
    {
      $set: {
        bankModuleConfiguration: configuration,
        bankModuleConfigurationUpdatedBy: updatedBy,
        recordUpdatedDateTime: now,
      },
    },
  );
  const record = await findModuleConfiguration(db, capability);
  return record ? { ok: true, record } : { ok: false, text: 'the configuration could not be read back' };
}

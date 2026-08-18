import { Db } from 'mongodb';
import bcrypt from 'bcryptjs';
import {
  TPP_REGISTRATION_COLLECTION, TppRegistrationControlRecord, TppRegistrationSeedRecord,
} from '../../modules/tpp-trust/models/tppRegistration.model';
import { findRegistrationByClientId, hashClientSecret } from '../../modules/tpp-trust/services/tppRegistration.service';
import { readSeedFile } from './readSeedFile';
import { config } from '../../config';

// Registers Leafy Pay as a TPP so a fresh deploy of both services is integrated with no manual step.
//
// The credential VALUE is a seed-time input (environment, with a local default) because a shared secret
// has to originate somewhere: the two sides cannot derive the same one independently. What is stored
// here is only the bcrypt verifier, so the repository holds no usable credential and the bank cannot
// disclose one either.
export async function seedTppRegistrations(db: Db): Promise<number> {
  const records = readSeedFile<TppRegistrationSeedRecord[]>('tppRegistrations.json');
  if (records.length !== 1) {
    // One configured credential, so one platform TPP. A second one needs its own credential source.
    throw new Error(`tppRegistrations.json must hold exactly one registration, found ${records.length}`);
  }
  const [record] = records;
  const clientId = config.bank.tppSeedClientId;

  // Re-hashing on every seed would rotate the secret silently and invalidate a PSP that already holds
  // the credential, so an existing hash is kept while it still verifies the configured secret.
  const existing = await findRegistrationByClientId(db, clientId);
  const existingHash = existing?.tppRegistrationClientSecretHash;
  const keepExisting = Boolean(existingHash)
    && await bcrypt.compare(config.bank.tppSeedClientSecret, existingHash!);

  await db.collection<TppRegistrationControlRecord>(TPP_REGISTRATION_COLLECTION).updateOne(
    { tppRegistrationInstanceReference: record.tppRegistrationInstanceReference },
    {
      $set: {
        ...record,
        tppRegistrationClientId: clientId,
        tppRegistrationClientSecretHash: keepExisting
          ? existingHash!
          : await hashClientSecret(config.bank.tppSeedClientSecret),
        recordUpdatedDateTime: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
  console.log(`  ${TPP_REGISTRATION_COLLECTION}: 1 TPP registration upserted (client_id ${clientId})`);
  return 1;
}

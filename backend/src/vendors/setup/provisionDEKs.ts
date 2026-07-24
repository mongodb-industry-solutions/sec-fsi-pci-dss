import { MongoClient } from 'mongodb';
import { provisionDataEncryptionKeys, DEKs } from '../encryption/keyVault';
import { getKmsConfig } from '../encryption/kms';
import { provisionCardIssuerCvk } from '../../providers/card-issuer/services/cardVerificationKey.service';

const kmsConfig = getKmsConfig();

export async function provisionDEKs(client: MongoClient): Promise<DEKs> {
  const keyVaultDb = client.db(kmsConfig.database);
  await keyVaultDb.collection(kmsConfig.collection).createIndex(
    { keyAltNames: 1 },
    {
      unique: true,
      partialFilterExpression: { keyAltNames: { $exists: true } },
    }
  );
  const deks = await provisionDataEncryptionKeys(client);
  // v30: provision the issuer Card Verification Key (envelope KMS -> DEK -> CVK), idempotent.
  await provisionCardIssuerCvk(client);
  return deks;
}

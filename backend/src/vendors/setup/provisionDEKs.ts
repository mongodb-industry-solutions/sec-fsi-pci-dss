import { MongoClient } from 'mongodb';
import { provisionDataEncryptionKeys, DEKs } from '../encryption/keyVault';
import { getKmsConfig } from '../encryption/kms';

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
  return provisionDataEncryptionKeys(client);
}

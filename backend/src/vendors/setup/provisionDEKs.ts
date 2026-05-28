import { MongoClient } from 'mongodb';
import { provisionDataEncryptionKeys } from '../encryption/keyVault';

export async function provisionDEKs(client: MongoClient) {
  const keyVaultDb = client.db('encryption');
  await keyVaultDb.collection('__keyVault').createIndex(
    { keyAltNames: 1 },
    {
      unique: true,
      partialFilterExpression: { keyAltNames: { $exists: true } },
    }
  );
  return provisionDataEncryptionKeys(client);
}

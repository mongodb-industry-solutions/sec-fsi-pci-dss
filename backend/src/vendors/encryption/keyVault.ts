import { MongoClient, ClientEncryption } from 'mongodb';
import { buildKmsProviders, buildCmkOptions } from './kms';

const KEY_VAULT_NAMESPACE = 'encryption.__keyVault';

export async function provisionDataEncryptionKeys(client: MongoClient) {
  const kmsProviders = buildKmsProviders();
  const cmkOptions = buildCmkOptions();

  const clientEncryption = new ClientEncryption(client, {
    keyVaultNamespace: KEY_VAULT_NAMESPACE,
    kmsProviders,
  });

  const keyVaultColl = client.db('encryption').collection('__keyVault');

  async function getOrCreate(keyName: string) {
    const existing = await keyVaultColl.findOne({ keyAltNames: keyName });
    if (existing) return existing._id;

    return clientEncryption.createDataKey(
      process.env.KMS_PROVIDER === 'local' ? 'local' : 'aws',
      {
        masterKey: cmkOptions?.aws,
        keyAltNames: [keyName],
      }
    );
  }

  const dekLookupId = await getOrCreate('DEK-lookup');
  const dekSensitiveId = await getOrCreate('DEK-sensitive');

  return { dekLookupId, dekSensitiveId };
}

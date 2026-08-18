import { MongoClient, Binary, ClientEncryption } from 'mongodb';
import { buildKmsProviders } from './qeClient';
import { BankDeks } from './encryptedFieldsMaps';
import { config, keyVaultNamespaceParts } from '../../config';

// Provisions the bank's DEKs in the SHARED key vault, by alt name, so a re-run reuses them. The names
// are bank scoped (`DEK-bank-*`) so the two services never fight over one key's meaning even though
// they share the vault.
export async function provisionBankDeks(client: MongoClient): Promise<BankDeks> {
  const { database, collection } = keyVaultNamespaceParts();
  const clientEncryption = new ClientEncryption(client, {
    keyVaultNamespace: `${database}.${collection}`,
    kmsProviders: buildKmsProviders(),
  });
  const keyVault = client.db(database).collection(collection);

  const masterKey = config.kms.provider === 'aws' && config.kms.awsCmkArn
    ? { key: config.kms.awsCmkArn, region: config.kms.awsRegion }
    : undefined;

  async function getOrCreate(keyName: string): Promise<Binary> {
    const existing = await keyVault.findOne({ keyAltNames: keyName });
    if (existing) {
      console.log(`    reuse: ${keyName}`);
      return existing._id as unknown as Binary;
    }
    const id = await clientEncryption.createDataKey(config.kms.provider, { masterKey, keyAltNames: [keyName] });
    console.log(`    new:   ${keyName}`);
    return id as unknown as Binary;
  }

  return {
    accountIban: await getOrCreate('DEK-bank-account-iban'),
    accountHolderName: await getOrCreate('DEK-bank-holder-name'),
    accountHolderEmail: await getOrCreate('DEK-bank-holder-email'),
  };
}

// Every keyId the bank's QE collections were created with must still exist in the shared key vault.
// The PSP drop takes that vault with it, so a bank database that survived a PSP reset keeps pointing
// at DEKs that are gone. Left undetected it surfaces on the first encrypted read as "not all keys
// requested were satisfied", which reads like a driver fault rather than a stale database.
export async function findOrphanedDeks(client: MongoClient, dbName: string): Promise<string[]> {
  const { database, collection } = keyVaultNamespaceParts();
  const keyVault = client.db(database).collection(collection);
  const collections = await client.db(dbName)
    .listCollections({}, { nameOnly: false })
    .toArray() as Array<{ name: string; options?: { encryptedFields?: { fields?: Array<{ keyId?: Binary }> } } }>;

  const orphans: string[] = [];
  for (const info of collections) {
    for (const field of info.options?.encryptedFields?.fields ?? []) {
      if (!field.keyId) continue;
      const found = await keyVault.countDocuments({ _id: field.keyId as never }, { limit: 1 });
      if (!found) orphans.push(info.name);
    }
  }
  return [...new Set(orphans)];
}

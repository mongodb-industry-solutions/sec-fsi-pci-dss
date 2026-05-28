import { MongoClient, Binary } from 'mongodb';
import { buildKmsProviders } from './kms';
import { buildEncryptedFieldsMaps } from './encryptedFieldsMaps';
import { provisionDataEncryptionKeys } from './keyVault';

const KEY_VAULT_NAMESPACE = 'encryption.__keyVault';
let _client: MongoClient | null = null;

export async function getQEClient(): Promise<MongoClient> {
  if (_client) return _client;

  const plainClient = new MongoClient(process.env.MONGODB_URI!);
  await plainClient.connect();
  const { dekLookupId, dekSensitiveId } = await provisionDataEncryptionKeys(plainClient);
  await plainClient.close();

  const encryptedFieldsMap = buildEncryptedFieldsMaps(dekLookupId as Binary, dekSensitiveId as Binary);
  const dbName = process.env.MONGODB_DB_NAME!;

  _client = new MongoClient(process.env.MONGODB_URI!, {
    autoEncryption: {
      keyVaultNamespace: KEY_VAULT_NAMESPACE,
      kmsProviders: buildKmsProviders(),
      encryptedFieldsMap: {
        [`${dbName}.cardTransaction`]: encryptedFieldsMap.cardTransaction,
        [`${dbName}.cardTransactionSensitive`]: encryptedFieldsMap.cardTransactionSensitive,
        [`${dbName}.customerAgreement`]: encryptedFieldsMap.customerAgreement,
        [`${dbName}.customerAgreementSensitive`]: encryptedFieldsMap.customerAgreementSensitive,
        [`${dbName}.paymentCard`]: encryptedFieldsMap.paymentCard,
        [`${dbName}.partyAuthentication`]: encryptedFieldsMap.partyAuthentication,
      },
      extraOptions: { cryptSharedLibRequired: true },
    },
  });

  await _client.connect();
  return _client;
}

export async function closeQEClient(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
  }
}

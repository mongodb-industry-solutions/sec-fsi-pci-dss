import { MongoClient } from 'mongodb';
import { buildKmsProviders } from './kms';
import { buildEncryptedFieldsMaps } from './encryptedFieldsMaps';
import { provisionDataEncryptionKeys } from './keyVault';
import { resolveCryptLibOptions } from './cryptLib';

const KEY_VAULT_NAMESPACE = 'encryption.__keyVault';
let _client: MongoClient | null = null;

export async function getQEClient(): Promise<MongoClient> {
  if (_client) return _client;

  // Plain client to resolve DEK IDs from the key vault
  const plainClient = new MongoClient(process.env.MONGODB_URI!);
  await plainClient.connect();
  const deks = await provisionDataEncryptionKeys(plainClient);
  await plainClient.close();

  const encryptedFieldsMap = buildEncryptedFieldsMaps(deks);
  const dbName = process.env.MONGODB_DB_NAME!;
  const cryptLib = resolveCryptLibOptions();

  _client = new MongoClient(process.env.MONGODB_URI!, {
    autoEncryption: {
      keyVaultNamespace: KEY_VAULT_NAMESPACE,
      kmsProviders: buildKmsProviders(),
      encryptedFieldsMap: {
        [`${dbName}.cardTransaction`]:             encryptedFieldsMap.cardTransaction,
        [`${dbName}.cardTransactionSensitive`]:    encryptedFieldsMap.cardTransactionSensitive,
        [`${dbName}.customerAgreement`]:           encryptedFieldsMap.customerAgreement,
        [`${dbName}.customerAgreementSensitive`]:  encryptedFieldsMap.customerAgreementSensitive,
        [`${dbName}.paymentCard`]:                 encryptedFieldsMap.paymentCard,
        [`${dbName}.partyAuthentication`]:         encryptedFieldsMap.partyAuthentication,
      },
      extraOptions: {
        ...(cryptLib.cryptSharedLibPath && { cryptSharedLibPath: cryptLib.cryptSharedLibPath }),
        cryptSharedLibRequired: cryptLib.cryptSharedLibRequired,
      },
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

import { MongoClient, ClientEncryption, Binary } from 'mongodb';
import { buildKmsProviders } from '../encryption/kms';
import { buildEncryptedFieldsMaps } from '../encryption/encryptedFieldsMaps';

const KEY_VAULT_NAMESPACE = 'encryption.__keyVault';

export async function createCollections(
  client: MongoClient,
  dekLookupId: Binary,
  dekSensitiveId: Binary,
  reset = false
) {
  const dbName = process.env.MONGODB_DB_NAME!;
  const db = client.db(dbName);
  const maps = buildEncryptedFieldsMaps(dekLookupId, dekSensitiveId);

  const clientEncryption = new ClientEncryption(client, {
    keyVaultNamespace: KEY_VAULT_NAMESPACE,
    kmsProviders: buildKmsProviders(),
  });

  const qeCollections = [
    { name: 'cardTransaction', map: maps.cardTransaction },
    { name: 'cardTransactionSensitive', map: maps.cardTransactionSensitive },
    { name: 'customerAgreement', map: maps.customerAgreement },
    { name: 'customerAgreementSensitive', map: maps.customerAgreementSensitive },
    { name: 'paymentCard', map: maps.paymentCard },
    { name: 'partyAuthentication', map: maps.partyAuthentication },
  ] as const;

  const existingList = await db.listCollections().toArray();
  const existingNames = new Set(existingList.map((c) => c.name));

  for (const { name, map } of qeCollections) {
    if (existingNames.has(name)) {
      if (reset) {
        await db.collection(name).drop();
        console.log(`  dropped: ${name}`);
      } else {
        console.log(`  skip: ${name} already exists`);
        continue;
      }
    }

    const provider = process.env.KMS_PROVIDER === 'local' ? 'local' : 'aws';
    const masterKey =
      process.env.KMS_PROVIDER !== 'local'
        ? { key: process.env.AWS_CMK_ARN!, region: process.env.AWS_REGION! }
        : undefined;

    await clientEncryption.createEncryptedCollection(db, name, {
      provider,
      createCollectionOptions: { encryptedFields: map },
      ...(masterKey && { masterKey }),
    });
    console.log(`  created: ${name}`);
  }

  if (!existingNames.has('fraudDiagnosisCase') || reset) {
    if (existingNames.has('fraudDiagnosisCase') && reset) {
      await db.collection('fraudDiagnosisCase').drop();
      console.log('  dropped: fraudDiagnosisCase');
    }
    await db.createCollection('fraudDiagnosisCase');
    console.log('  created: fraudDiagnosisCase');
  } else {
    console.log('  skip: fraudDiagnosisCase already exists');
  }
}

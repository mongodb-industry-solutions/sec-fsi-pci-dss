// Queryable Encryption client for bankcore. It points at the PSP key vault and reuses its DEKs, so
// no new key material exists on this side.
//
// Unlike the PSP's client this one never searches platform default locations for crypt_shared: the
// path is required and validated at startup. A wrong or missing library fails the whole connection
// and surfaces as a generic 503, which is expensive to diagnose, and the two services must load the
// same version anyway.
import { existsSync } from 'fs';
import { MongoClient, KMSProviders } from 'mongodb';
import { config, keyVaultNamespaceParts } from '../../config';

let client: MongoClient | null = null;

export function buildKmsProviders(): KMSProviders {
  if (config.kms.provider === 'local') {
    const key = config.kms.localMasterKey;
    if (!key) throw new Error('PSP_KMS_LOCAL_MASTER_KEY is required when PSP_KMS_PROVIDER=local');
    return { local: { key: Buffer.from(key, 'base64') } };
  }
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required when PSP_KMS_PROVIDER=aws');
  }
  return { aws: { accessKeyId, secretAccessKey, ...(sessionToken && { sessionToken }) } };
}

// Fails at startup rather than at first encrypted read, where it looks like a connection outage.
export function assertCryptSharedLib(): string {
  const path = config.mongodb.cryptSharedLibPath;
  if (!path) {
    throw new Error(
      'crypt_shared library path is not set. Set PSP_BANKCORE_CRYPT_SHARED_LIB_PATH, or '
      + 'MONGODB_CRYPT_SHARED_LIB_PATH to share the PSP value. Both services must load the same version.',
    );
  }
  if (!existsSync(path)) {
    throw new Error(`crypt_shared library not found at "${path}" (PSP_BANKCORE_CRYPT_SHARED_LIB_PATH)`);
  }
  return path;
}

export async function getQEClient(): Promise<MongoClient> {
  if (client) return client;
  if (!config.mongodb.uri) throw new Error('PSP_BANKCORE_DB_URI or MONGODB_URI must be set');

  const cryptSharedLibPath = assertCryptSharedLib();
  const { database, collection } = keyVaultNamespaceParts();

  client = new MongoClient(config.mongodb.uri, {
    autoEncryption: {
      keyVaultNamespace: `${database}.${collection}`,
      kmsProviders: buildKmsProviders(),
      extraOptions: {
        // Driver 7 types this as a `${string}mongo_crypt_v${number}.{so,dll,dylib}` template.
        cryptSharedLibPath: cryptSharedLibPath as `${string}mongo_crypt_v${number}.so`,
        cryptSharedLibRequired: true,
      },
    },
  });
  await client.connect();
  return client;
}

export async function closeQEClient(): Promise<void> {
  if (!client) return;
  const closing = client;
  client = null;
  await closing.close();
}

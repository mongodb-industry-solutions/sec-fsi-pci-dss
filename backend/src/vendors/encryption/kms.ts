import { KMSProviders } from 'mongodb';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../../../.env') });

export function buildKmsProviders(): KMSProviders {
  if (process.env.KMS_PROVIDER === 'local') {
    const key = process.env.KMS_LOCAL_MASTER_KEY;
    if (!key) throw new Error('KMS_LOCAL_MASTER_KEY is required when KMS_PROVIDER=local');
    return { local: { key: Buffer.from(key, 'base64') } };
  }

  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required when KMS_PROVIDER=aws');
  }

  return {
    aws: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
      ...(AWS_SESSION_TOKEN && { sessionToken: AWS_SESSION_TOKEN }),
    },
  };
}

export function buildCmkOptions() {
  if (process.env.KMS_PROVIDER === 'local') return undefined;

  const { AWS_CMK_ARN, AWS_REGION } = process.env;
  if (!AWS_CMK_ARN || !AWS_REGION) {
    throw new Error('AWS_CMK_ARN and AWS_REGION are required for AWS KMS');
  }

  return { aws: { key: AWS_CMK_ARN, region: AWS_REGION } };
}

export function getKmsConfig(): { collection: string; database: string; namespace: string; uri: string; provider: 'local' | 'aws'; } {
  const uri = process.env.KMS_KEY_VAULT_URI ?? process.env.MONGODB_URI ?? (() => { throw new Error('MONGODB_URI is not set.'); })();
  const database = process.env.KMS_KEY_VAULT_DATABASE ?? 'encryption';
  const collection = process.env.KMS_KEY_VAULT_COLLECTION ?? '__keyVault';
  const provider = process.env.KMS_PROVIDER === 'local' ? 'local' : 'aws';
  return {
    uri,
    provider,
    database,
    collection,
    namespace: `${database}.${collection}`,
  };
}
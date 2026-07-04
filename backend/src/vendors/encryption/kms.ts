import { KMSProviders } from 'mongodb';
import { config } from '../../config';

export function buildKmsProviders(): KMSProviders {
  if (config.kms.provider === 'local') {
    const key = config.kms.localMasterKey;
    if (!key) throw new Error('KMS_LOCAL_MASTER_KEY is required when KMS_PROVIDER=local');
    return { local: { key: Buffer.from(key, 'base64') } };
  }

  const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
  const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
  const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN;
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
  if (config.kms.provider === 'local') return undefined;

  const awsCmkArn = config.kms.awsCmkArn;
  const awsRegion = config.kms.awsRegion;
  if (!awsCmkArn || !awsRegion) {
    throw new Error('AWS_CMK_ARN and AWS_REGION are required for AWS KMS');
  }

  return { aws: { key: awsCmkArn, region: awsRegion } };
}

export function getKmsConfig(): { collection: string; database: string; namespace: string; uri: string; provider: 'local' | 'aws'; } {
  const uri = config.kms.keyVaultUri ?? config.mongodb.uri ?? (() => { throw new Error('MONGODB_URI is not set.'); })();
  const database = config.kms.keyVaultDatabase;
  const collection = config.kms.keyVaultCollection;
  const provider = config.kms.provider;
  return {
    uri,
    provider,
    database,
    collection,
    namespace: `${database}.${collection}`,
  };
}

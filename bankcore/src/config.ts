import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

// Same convention as the PSP: PSP_-prefixed for platform vars, then the legacy bare name.
// Every bankcore variable carries the PSP_ prefix too, so the platform stays one namespace.
function pspEnv(name: string, fallback?: string): string | undefined {
  return process.env[`PSP_${name}`] ?? process.env[name] ?? fallback;
}

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',

  server: {
    host: env('HOST', '0.0.0.0')!,
    // Own port: the merchant app already owns 8082.
    port: parseInt(pspEnv('BANKCORE_PORT', '8083')!, 10),
    // Private, service to service. bankcore has no public ingress and no browser ever calls it.
    baseUrl: pspEnv('BANKCORE_BASE_URL', 'http://localhost:8083')!,
    // The PSP host, for the status-change callbacks bankcore delivers to its registered TPP.
    pspBaseUrl: pspEnv('BASE_URL', 'http://127.0.0.1:8081')!,
  },

  mongodb: {
    // Defaults to the PSP cluster: same cluster, separate database.
    uri: pspEnv('BANKCORE_DB_URI') ?? env('MONGODB_URI', '')!,
    dbName: pspEnv('BANKCORE_DB_NAME', 'bankcoredb')!,
    // Must be the same crypt_shared version the PSP loads; a mismatch fails the whole connection.
    cryptSharedLibPath: pspEnv('BANKCORE_CRYPT_SHARED_LIB_PATH')
      ?? env('MONGODB_CRYPT_SHARED_LIB_PATH', '')!,
  },

  kms: {
    // Shared key vault and shared DEKs, so the namespace is the PSP's KMS namespace.
    provider: (pspEnv('KMS_PROVIDER', 'local')!) as 'local' | 'aws',
    localMasterKey: pspEnv('KMS_LOCAL_MASTER_KEY') ?? pspEnv('LOCAL_MASTER_KEY'),
    keyVaultNamespace: pspEnv('BANKCORE_KEY_VAULT_NAMESPACE')
      ?? `${pspEnv('KMS_KEY_VAULT_DATABASE', 'encryption')}.${pspEnv('KMS_KEY_VAULT_COLLECTION', '__keyVault')}`,
    keyVaultUri: pspEnv('KMS_KEY_VAULT_URI'),
    awsCmkArn: env('AWS_CMK_ARN') ?? env('AWS_KMS_KEY_ARN'),
    awsRegion: env('AWS_REGION', 'us-east-1')!,
  },

  bank: {
    // 'automatic' lands a new PSD2 consent valid; 'manual' leaves it received for an operator.
    consentMode: (pspEnv('BANKCORE_CONSENT_MODE', 'automatic')!) as 'automatic' | 'manual',
  },

  app: {
    eventBusEngine: (pspEnv('BANKCORE_EVENT_BUS_ENGINE', 'in-process')!) as 'in-process' | 'kafka' | 'rabbitmq',
    eventBusTopicPrefix: pspEnv('BANKCORE_EVENT_BUS_TOPIC_PREFIX', 'bankcore')!,
    seedDataDir: pspEnv('BANKCORE_SEED_DATA_DIR'),
  },

  kafka: {
    brokers: (pspEnv('KAFKA_BROKERS', 'localhost:9092')!).split(',').map((s) => s.trim()),
    clientId: pspEnv('KAFKA_CLIENT_ID', 'bankcore')!,
    ssl: pspEnv('KAFKA_SSL', 'false') === 'true',
    saslMechanism: pspEnv('KAFKA_SASL_MECHANISM'),
    saslUsername: pspEnv('KAFKA_SASL_USERNAME'),
    saslPassword: pspEnv('KAFKA_SASL_PASSWORD'),
  },

  rabbitmq: {
    url: pspEnv('RABBITMQ_URL', 'amqp://localhost')!,
  },
} as const;

export function keyVaultNamespaceParts(): { database: string; collection: string } {
  const [database, ...rest] = config.kms.keyVaultNamespace.split('.');
  return { database, collection: rest.join('.') };
}

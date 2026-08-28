import * as dotenv from 'dotenv';
import { createHash } from 'crypto';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

// Same convention as the PSP: PSP_-prefixed for platform vars, then the legacy bare name.
// Every bankcore variable carries the PSP_ prefix too, so the platform stays one namespace.
function pspEnv(name: string, fallback?: string): string | undefined {
  return process.env[`PSP_${name}`] ?? process.env[name] ?? fallback;
}

function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

// Domain separated key derivation: a distinct secret per purpose out of one configured value, so two
// mechanisms never end up accepting each other's tokens.
function deriveKey(purpose: string, secret: string): string {
  return createHash('sha256').update(`${purpose}:${secret}`).digest('hex');
}

/**
 * The bank's OWN root secret. It never reads the platform's.
 *
 * This is the institutional boundary made real rather than declared. A bank is a separate
 * institution, and a key it derives from the platform's secret is a key the platform holds; the
 * refusal it is supposed to produce would then be a matter of the platform choosing not to mint a
 * token rather than being unable to. The default differs from the platform's default too, so a
 * deployment that configures nothing at all still has two distinct keys.
 */
function bankcoreRoot(): string {
  return pspEnv('BANKCORE_SECRET', 'bankcore-local-secret-change-in-production')!;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',

  server: {
    host: env('HOST', '0.0.0.0')!,
    // Own port: the merchant app already owns 8082.
    port: parseInt(pspEnv('BANKCORE_PORT', '8083')!, 10),
    // Private, service to service. This is the URL the PSP uses.
    baseUrl: pspEnv('BANKCORE_BASE_URL', 'http://localhost:8083')!,
    // Public, browser facing, for reviewing and exercising the Open Banking API in Swagger. Empty by
    // default: a deployment that does not publish the bank simply has no public server entry.
    publicUrl: pspEnv('BANKCORE_PUBLIC_URL', '')!,
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
    // Signs the access tokens the bank issues to its TPPs. It must NOT be the shared platform secret:
    // the whole point is that a token minted elsewhere on the platform cannot open the banking API. The
    // default derives a distinct key from it, so a deployment is secure without extra configuration
    // while still being able to set a genuinely independent one.
    // v39 P4: derived from the BANK's own root, never from the platform secret.
    //
    // It used to derive from `PSP_JWT_SECRET`, which meant the platform's session key ultimately
    // controlled the bank's access tokens: whoever could mint a platform token held the material
    // behind this one. A derivation is not a boundary when both sides share the input.
    accessTokenSecret: pspEnv('BANKCORE_ACCESS_TOKEN_SECRET')
      ?? deriveKey('bankcore-tpp-access-token', bankcoreRoot()),
    // Read at SEED time only, to write the bank's verifier and the PSP's credential. At runtime the
    // bank reads the hash from its registration record and never this value.
    tppSeedClientId: pspEnv('BANKCORE_TPP_CLIENT_ID', 'leafypay-psp')!,
    tppSeedClientSecret: pspEnv('BANKCORE_TPP_CLIENT_SECRET', 'dev-bankcore-tpp-secret')!,
  },

  app: {
    /**
     * The bank's own diagnostics credential (v39 P4).
     *
     * It used to be the platform's `JWT_SECRET`, so a token minted anywhere on the platform opened
     * part of this bank's surface. That is the defect the institutional boundary was supposed to
     * prevent and did not: the boundary existed in the documentation and not in the key material.
     *
     * The PSP holds this the way any client holds a credential for a service it calls, configured
     * under the same name on both sides. That is a credential, not a shared identity, and the
     * difference is that a platform session token can no longer stand in for it.
     *
     * It goes away entirely when the bank verifies the authority's tokens instead.
     */
    adminSecret: pspEnv('BANKCORE_ADMIN_SECRET') ?? deriveKey('bankcore:admin', bankcoreRoot()),
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

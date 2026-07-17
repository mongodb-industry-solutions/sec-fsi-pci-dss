import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../.env') });

// Reads PSP_-prefixed env var for app-specific vars with no existing meaningful prefix.
// Falls back to legacy unprefixed name, then to default.
function pspEnv(name: string, fallback?: string): string | undefined {
  return process.env[`PSP_${name}`] ?? process.env[name] ?? fallback;
}

// Reads an env var directly (no PSP_ prefix). Used for standard globals (PORT, HOST)
// and already-prefixed external-system vars (MONGODB_*, ATLAS_*, AWS_CMK_ARN, AWS_REGION).
function env(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',

  server: {
    host: env('HOST', '0.0.0.0')!,
    port: parseInt(env('PORT', '8081')!, 10),
    corsOrigin: pspEnv('CORS_ORIGIN', 'http://localhost:3000')!,
    baseUrl: pspEnv('BASE_URL', 'http://127.0.0.1:8081')!,
    urlFrontend: pspEnv('URL_FRONTEND', 'http://localhost:3000')!,
    projectRoot: pspEnv('PROJECT_ROOT'),
  },

  mongodb: {
    uri: env('MONGODB_URI', '')!,
    uriLevel1: env('MONGODB_URI_LEVEL1'),
    uriLevel2: env('MONGODB_URI_LEVEL2'),
    dbName: env('MONGODB_DB_NAME', 'pcidb')!,
    cryptSharedLibPath: env('MONGODB_CRYPT_SHARED_LIB_PATH', '')!,
  },

  qe: {
    // QE text search (substring/prefix/suffix) needs MongoDB 8.2+ and mongodb-client-encryption 7.2.
    // Default TRUE (assume a recent Atlas). Set PSP_QE_TEXT_SEARCH=false for pre-8.2 clusters:
    // text-search fields degrade to QE:equality (still encrypted + searchable exactly, still lookup-tier)
    // so setup never fails and L1 keeps decrypting them.
    textSearch: pspEnv('QE_TEXT_SEARCH', 'true') !== 'false',
  },

  kms: {
    provider: (pspEnv('KMS_PROVIDER', 'local')!) as 'local' | 'aws',
    localMasterKey: pspEnv('KMS_LOCAL_MASTER_KEY') ?? pspEnv('LOCAL_MASTER_KEY'),
    keyVaultUri: pspEnv('KMS_KEY_VAULT_URI'),
    keyVaultDatabase: pspEnv('KMS_KEY_VAULT_DATABASE', 'encryption')!,
    keyVaultCollection: pspEnv('KMS_KEY_VAULT_COLLECTION', '__keyVault')!,
    awsCmkArn: env('AWS_CMK_ARN') ?? env('AWS_KMS_KEY_ARN'),
    awsRegion: env('AWS_REGION', 'us-east-1')!,
  },

  oauth: {
    keyProvider: (pspEnv('OAUTH_KEY_PROVIDER', 'local')!) as 'local' | 'aws',
    keyStoreDir: pspEnv('OAUTH_KEY_STORE_DIR', './keys')!,
    awsKeyArn: pspEnv('OAUTH_AWS_KEY_ARN'),
    awsRegion: pspEnv('OAUTH_AWS_REGION', 'us-east-1')!,
  },

  atlas: {
    publicKey: env('ATLAS_PUBLIC_KEY'),
    privateKey: env('ATLAS_PRIVATE_KEY'),
    projectId: env('ATLAS_PROJECT_ID'),
    dbUserLevel1: env('ATLAS_DB_USER_LEVEL1'),
    dbUserLevel1Password: env('ATLAS_DB_USER_LEVEL1_PASSWORD'),
    dbUserLevel2: env('ATLAS_DB_USER_LEVEL2'),
    dbUserLevel2Password: env('ATLAS_DB_USER_LEVEL2_PASSWORD'),
  },

  kafka: {
    brokers: (pspEnv('KAFKA_BROKERS', 'localhost:9092')!).split(',').map((s) => s.trim()),
    clientId: pspEnv('KAFKA_CLIENT_ID', 'pci-psp')!,
    ssl: pspEnv('KAFKA_SSL', 'false') === 'true',
    saslMechanism: pspEnv('KAFKA_SASL_MECHANISM'),
    saslUsername: pspEnv('KAFKA_SASL_USERNAME'),
    saslPassword: pspEnv('KAFKA_SASL_PASSWORD'),
  },

  rabbitmq: {
    url: pspEnv('RABBITMQ_URL', 'amqp://localhost')!,
  },

  app: {
    adminUser: pspEnv('ADM_USER'),
    adminPass: pspEnv('ADM_PASS'),
    jwtSecret: pspEnv('JWT_SECRET', 'dev-secret-change-me')!,
    jwtExpiresIn: pspEnv('JWT_EXPIRES_IN', '24h')!,
    fraudAmountThreshold: parseFloat(pspEnv('FRAUD_AMOUNT_THRESHOLD', '500')!),
    riskMccList: (pspEnv('RISK_MCC_LIST', '5812,6011,7995')!).split(',').map((s) => s.trim()),
    eventBusEngine: (pspEnv('EVENT_BUS_ENGINE', 'in-process')!) as 'in-process' | 'kafka' | 'rabbitmq',
    eventBusTopicPrefix: pspEnv('EVENT_BUS_TOPIC_PREFIX', 'pci.psp')!,
    seedDataDir: pspEnv('SEED_DATA_DIR'),
  },

  payout: {
    // Builtin payment-initiation module — simulated settlement delays (T+N)
    settlementDelayT1Ms: parseInt(pspEnv('PAYOUT_SETTLEMENT_DELAY_T1_MS', '3000')!, 10),
    settlementDelayT2Ms: parseInt(pspEnv('PAYOUT_SETTLEMENT_DELAY_T2_MS', '6000')!, 10),
    settlementDelayT3Ms: parseInt(pspEnv('PAYOUT_SETTLEMENT_DELAY_T3_MS', '9000')!, 10),
    // Set to 'false' in staging to simulate 5% random rail failures
    paymentInitiationAlwaysSucceed: pspEnv('PAYMENT_INITIATION_ALWAYS_SUCCEED', 'true') === 'true',
    // Builtin account-information module
    aisAlwaysVerify: pspEnv('AIS_ALWAYS_VERIFY', 'true') === 'true',
    // SD-54 Counterparty Administration — beneficiary registry limits
    beneficiaryMaxPerUser: parseInt(pspEnv('BENEFICIARY_MAX_PER_USER', '100')!, 10),
    beneficiaryRateLimitRpm: parseInt(pspEnv('BENEFICIARY_RATE_LIMIT_RPM', '20')!, 10),
    // v17.1 Bank transfers — sandbox mode (transfers are simulated end to end; no real rail effect)
    sandbox: pspEnv('PAYOUT_SANDBOX', 'true') === 'true',
    // v17.1 Recurring mandate scheduler poll interval (ms); 0 disables the background runner.
    mandateSchedulerMs: parseInt(pspEnv('PAYOUT_MANDATE_SCHEDULER_MS', '60000')!, 10),
    // v17.1 Rail fee schedule (config-driven, single source; consumed by FeeCalculator)
    railFees: {
      sepa: parseFloat(pspEnv('PAYOUT_FEE_SEPA', '0')!),
      ach: parseFloat(pspEnv('PAYOUT_FEE_ACH', '0.25')!),
      swift: parseFloat(pspEnv('PAYOUT_FEE_SWIFT', '15')!),
      localBank: parseFloat(pspEnv('PAYOUT_FEE_LOCAL_BANK', '0')!),
      swiftCorrespondentSurcharge: parseFloat(pspEnv('PAYOUT_FEE_SWIFT_CORRESPONDENT', '10')!),
    },
  },
} as const;

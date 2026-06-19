import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { existsSync } from 'fs';
import * as https from 'https';
import { buildDigestHeader, parseWwwAuthenticate } from '../encryption/digest';
import { getKmsConfig } from '../encryption/kms';

dotenv.config({ path: resolve(__dirname, '../../../../.env') });

const ATLAS_API_BASE = 'cloud.mongodb.com';
const ATLAS_API_PATH = '/api/atlas/v2';

const EXPECTED_COLLECTIONS = [
  'party',
  'cardTransactionLog',
  'customerAgreementProcedure',
  'paymentCardManagement',
  'paymentCardRegistry',
  'customerAuthenticationAssessment',
  'authenticationDomain',
  'role',
  'partyAuthenticationAssessment',
  'fraudDiagnosisCase',
  'fraudDiagnosisCaseEvents',
  'fraudDiagnosisCustomerQuestion',
  'notification',
  'customerCreditRatingState',
  'consentAgreement',
  'consentAccessLog',
  // SD-193 External Provider Arrangements (dev.v7 Fase 2 — BIAN-pure rename + new module config)
  'externalProviderArrangement',
  'externalProviderArrangementActionLog',
  'externalProviderArrangementPortfolio',
  'capabilityModuleConfiguration',
  // dev.v8: unified Event Store (EDA backbone)
  'domainEvent',
];

// Unique index (primary ref field) per collection - representative index check
const EXPECTED_UNIQUE_INDEXES: Record<string, string> = {
  party:                            'partyInstanceReference',
  cardTransactionLog:               'cardTransactionInstanceReference',
  customerAgreementProcedure:       'customerAgreementInstanceReference',
  paymentCardManagement:            'paymentCardInstanceReference',
  paymentCardRegistry:              'paymentCardReference',
  customerAuthenticationAssessment: 'customerAuthenticationInstanceReference',
  fraudDiagnosisCase:               'fraudDiagnosisInstanceReference',
  fraudDiagnosisCustomerQuestion:   'customerQuestionInstanceReference',
  notification:                     'notificationInstanceReference',
  domainEvent:                      'eventId',
  partyAuthenticationAssessment:    'partyAuthenticationInstanceReference',
  authenticationDomain:             'partyAuthenticationDomainInstanceReference',
  role:                             'roleName',
  customerCreditRatingState:        'customerCreditRatingInstanceReference',
  consentAgreement:                 'consentAgreementInstanceReference',
  consentAccessLog:                 'consentAccessLogInstanceReference',
  externalProviderArrangement:          'externalProviderArrangementInstanceReference',
  externalProviderArrangementPortfolio: 'routingGroupInstanceReference',
  capabilityModuleConfiguration:        'capabilityModuleInstanceReference',
  // externalProviderArrangementActionLog is timeseries — no unique index (checked by presence only)
};

// -- Result tracking ----------------------------------------------------------

type Status = 'pass' | 'fail' | 'warn' | 'skip';

let pass = 0;
let fail = 0;
let warn = 0;

function check(status: Status, label: string, detail?: string) {
  const tag = status === 'pass' ? '[PASS]' : status === 'fail' ? '[FAIL]' : status === 'warn' ? '[WARN]' : '[SKIP]';
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`  ${tag} ${label}${suffix}`);
  if (status === 'pass') pass++;
  else if (status === 'fail') fail++;
  else if (status === 'warn') warn++;
}

function httpsGet(
  path: string,
  authHeader?: string,
): Promise<{ status: number; wwwAuthenticate?: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: ATLAS_API_BASE,
        path,
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.atlas.2023-01-01+json',
          ...(authHeader && { Authorization: authHeader }),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          wwwAuthenticate: res.headers['www-authenticate'] as string | undefined,
        }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function atlasGet(path: string, publicKey: string, privateKey: string): Promise<number> {
  try {
    const probe = await httpsGet(path);
    if (probe.status !== 401) return probe.status;
    const c = parseWwwAuthenticate(probe.wwwAuthenticate ?? '');
    const auth = buildDigestHeader(publicKey, privateKey, 'GET', path, c.realm, c.nonce, c.opaque);
    return (await httpsGet(path, auth)).status;
  } catch {
    return 0;
  }
}

// -- Section checks ----------------------------------------------------------─

function checkEnvVars(): boolean {
  console.log('\n1. Environment variables');

  const kms = process.env.KMS_PROVIDER;

  // -- 1.1 Core (required) ----------------------------------------------------
  console.log('   1.1 Core (required)');

  for (const v of ['MONGODB_URI', 'MONGODB_DB_NAME', 'KMS_PROVIDER']) {
    process.env[v]
      ? check('pass', v, v === 'MONGODB_DB_NAME' ? process.env[v] : undefined)
      : check('fail', v, 'not set - required');
  }

  // Semantic: MONGODB_URI format
  const uri = process.env.MONGODB_URI;
  if (uri && !uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    check('warn', 'MONGODB_URI format', 'does not start with mongodb:// or mongodb+srv://');
  }

  // JWT_SECRET is optional for local/demo: the app falls back to a built-in demo default
  // (auth, escalation tokens, admin). Warn (not fail) when unset or when it equals that default —
  // a strong secret is required only before any non-local deployment.
  if (!process.env.JWT_SECRET) {
    check('warn', 'JWT_SECRET', 'not set - app uses the built-in demo default; set a strong secret before any non-local deployment');
  } else if (process.env.JWT_SECRET === 'demo-local-secret-change-in-production') {
    check('warn', 'JWT_SECRET', 'using the hardcoded demo default - change before any non-local deployment');
  }

  // -- 1.2 KMS-specific --------------------------------------------------------
  console.log('   1.2 KMS-specific');

  if (kms === 'local') {
    const localKey = process.env.KMS_LOCAL_MASTER_KEY;
    localKey
      ? check('pass', 'KMS_LOCAL_MASTER_KEY')
      : check('fail', 'KMS_LOCAL_MASTER_KEY', 'not set - required for KMS_PROVIDER=local');

    if (localKey) {
      try {
        const decoded = Buffer.from(localKey, 'base64');
        decoded.length === 96
          ? check('pass', 'KMS_LOCAL_MASTER_KEY length', '96 bytes ✓')
          : check('fail', 'KMS_LOCAL_MASTER_KEY length', `expected 96 bytes, got ${decoded.length} - regenerate with setup:key`);
      } catch {
        check('fail', 'KMS_LOCAL_MASTER_KEY', 'invalid base64 encoding');
      }
    }
  } else if (kms === 'aws') {
    for (const v of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_CMK_ARN', 'AWS_REGION']) {
      process.env[v]
        ? check('pass', v)
        : check('fail', v, `not set - required for KMS_PROVIDER=aws`);
    }
  } else if (kms) {
    check('warn', 'KMS_PROVIDER', `unknown value '${kms}' - expected 'local' or 'aws'`);
  }

  // -- 1.3 Role pool URIs (optional) ------------------------------------------
  console.log('   1.3 Role pool URIs (optional)');

  for (const v of ['MONGODB_URI_LEVEL1', 'MONGODB_URI_LEVEL2']) {
    process.env[v]
      ? check('pass', v)
      : check('warn', v, 'not set - Level 1/2 role pools will fall back to main URI');
  }

  // -- 1.4 Atlas API (optional) ----------------------------------------------─
  console.log('   1.4 Atlas API (optional)');

  for (const v of ['ATLAS_PUBLIC_KEY', 'ATLAS_PRIVATE_KEY', 'ATLAS_PROJECT_ID']) {
    process.env[v]
      ? check('pass', v)
      : check('warn', v, 'not set - Atlas role/user checks will be skipped');
  }
  for (const v of ['ATLAS_DB_USER_LEVEL1', 'ATLAS_DB_USER_LEVEL2']) {
    process.env[v]
      ? check('pass', v)
      : check('warn', v, 'not set - Atlas DB user checks will be skipped');
  }

  // -- 1.5 Application runtime (optional) ------------------------------------
  console.log('   1.5 Application runtime (optional)');

  const apiPort = process.env.API_PORT;
  if (!apiPort) {
    check('warn', 'API_PORT', 'not set - defaulting to 3001');
  } else {
    const p = parseInt(apiPort, 10);
    (!isNaN(p) && p > 0 && p < 65536)
      ? check('pass', 'API_PORT', String(p))
      : check('warn', 'API_PORT', `'${apiPort}' is not a valid port number`);
  }

  process.env.API_HOST
    ? check('pass', 'API_HOST', process.env.API_HOST)
    : check('warn', 'API_HOST', 'not set - defaulting to 0.0.0.0');

  process.env.CORS_ORIGIN
    ? check('pass', 'CORS_ORIGIN', process.env.CORS_ORIGIN)
    : check('warn', 'CORS_ORIGIN', 'not set - defaulting to http://localhost:3000 (update for non-local deployments)');

  process.env.JWT_EXPIRES_IN
    ? check('pass', 'JWT_EXPIRES_IN', process.env.JWT_EXPIRES_IN)
    : check('warn', 'JWT_EXPIRES_IN', 'not set - defaulting to 24h');

  const nodeEnv = process.env.NODE_ENV;
  if (!nodeEnv) {
    check('warn', 'NODE_ENV', 'not set - recommend setting to development or production');
  } else if (!['development', 'production', 'test'].includes(nodeEnv)) {
    check('warn', 'NODE_ENV', `unexpected value '${nodeEnv}' - expected development, production, or test`);
  } else {
    check('pass', 'NODE_ENV', nodeEnv);
  }

  // -- 1.6 QE shared library (optional) --------------------------------------
  console.log('   1.6 QE shared library (optional)');

  const cryptPath = process.env.MONGODB_CRYPT_SHARED_LIB_PATH;
  if (!cryptPath) {
    check('warn', 'MONGODB_CRYPT_SHARED_LIB_PATH', 'not set - library will be auto-detected from default platform locations');
  } else if (!existsSync(cryptPath)) {
    check('fail', 'MONGODB_CRYPT_SHARED_LIB_PATH', `file not found at '${cryptPath}' - QE will fail to initialize`);
  } else {
    check('pass', 'MONGODB_CRYPT_SHARED_LIB_PATH', cryptPath);
  }

  return fail === 0;
}

async function checkMongoDB(client: MongoClient): Promise<void> {
  const dbName = process.env.MONGODB_DB_NAME ?? 'pci_demo';
  const kmsConfig = getKmsConfig();

  // -- Connectivity ------------------------------------------------------------
  console.log('\n2. MongoDB connectivity');

  try {
    await client.db().admin().ping();
    check('pass', 'main URI connected');
  } catch (e) {
    check('fail', 'main URI', `cannot connect - ${(e as Error).message}`);
    return;
  }

  for (const key of ['MONGODB_URI_LEVEL1', 'MONGODB_URI_LEVEL2'] as const) {
    const uri = process.env[key];
    if (!uri) { check('skip', key, 'not configured'); continue; }
    const c = new MongoClient(uri);
    try {
      await c.connect();
      await c.db().admin().ping();
      check('pass', `${key} connected`);
    } catch (e) {
      check('fail', key, `cannot connect - ${(e as Error).message}`);
    } finally {
      await c.close().catch(() => {});
    }
  }

  // -- Application database ----------------------------------------------------
  console.log(`\n3. Application database (${dbName})`);

  const db = client.db(dbName);
  const existing = await db.listCollections().toArray();
  const existingSet = new Set(existing.map((c) => c.name));

  const missing = EXPECTED_COLLECTIONS.filter((n) => !existingSet.has(n));
  const found   = EXPECTED_COLLECTIONS.length - missing.length;

  if (missing.length === 0) {
    check('pass', `collections - all ${EXPECTED_COLLECTIONS.length}/${EXPECTED_COLLECTIONS.length} present`);
  } else {
    check('fail', `collections - ${found}/${EXPECTED_COLLECTIONS.length} present`, `missing: ${missing.join(', ')}`);
  }

  // -- Indexes ----------------------------------------------------------------─
  console.log('\n4. Indexes');

  for (const [col, field] of Object.entries(EXPECTED_UNIQUE_INDEXES)) {
    if (!existingSet.has(col)) {
      check('skip', `${col} - collection missing`);
      continue;
    }
    try {
      const indexes = await db.collection(col).listIndexes().toArray();
      const hasIt   = indexes.some((idx) => idx.key?.[field] !== undefined && idx.unique === true);
      hasIt
        ? check('pass', `${col} - unique index on ${field}`)
        : check('fail', `${col} - unique index on ${field} not found`);
    } catch (e) {
      check('warn', `${col} - index check error: ${(e as Error).message}`);
    }
  }

  // -- Key vault --------------------------------------------------------------─
  console.log(`\n5. QE key vault (${kmsConfig.namespace})`);

  try {
    const kvDb      = client.db(kmsConfig.database);
    const kvList    = await kvDb.listCollections({ name: kmsConfig.collection }).toArray();
    if (kvList.length === 0) {
      check('fail', `${kmsConfig.collection} collection`, 'not found - run setup:db');
      return;
    }
    check('pass', `${kmsConfig.collection} collection exists`);

    const dekCount = await kvDb.collection(kmsConfig.collection).countDocuments();
    dekCount > 0
      ? check('pass', `DEKs present - ${dekCount} key(s)`)
      : check('fail', 'DEKs', 'no DEKs found - run setup:db');

    const kvIndexes = await kvDb.collection(kmsConfig.collection).listIndexes().toArray();
    const hasKvIdx  = kvIndexes.some((i) => i.key?.keyAltNames !== undefined);
    hasKvIdx
      ? check('pass', 'keyAltNames unique index present')
      : check('fail', 'keyAltNames unique index missing');
  } catch (e) {
    check('fail', 'key vault', (e as Error).message);
  }
}

async function checkAtlas(): Promise<void> {
  console.log('\n6. Atlas custom roles & DB users');

  const publicKey  = process.env.ATLAS_PUBLIC_KEY;
  const privateKey = process.env.ATLAS_PRIVATE_KEY;
  const projectId  = process.env.ATLAS_PROJECT_ID;

  if (!publicKey || !privateKey || !projectId) {
    check('skip', 'Atlas API checks', 'ATLAS_PUBLIC_KEY / ATLAS_PRIVATE_KEY / ATLAS_PROJECT_ID not set');
    return;
  }

  for (const role of ['pci_level1_role', 'pci_level2_role']) {
    const status = await atlasGet(
      `${ATLAS_API_PATH}/groups/${projectId}/customDBRoles/roleName/${role}`,
      publicKey, privateKey,
    );
    if (status === 200)     check('pass', `custom role ${role}`);
    else if (status === 404) check('fail', `custom role ${role}`, 'not found - run setup:db');
    else                     check('warn', `custom role ${role}`, `Atlas API returned HTTP ${status}`);
  }

  for (const envKey of ['ATLAS_DB_USER_LEVEL1', 'ATLAS_DB_USER_LEVEL2'] as const) {
    const user = process.env[envKey];
    if (!user) { check('skip', `${envKey}`, 'env var not set'); continue; }
    const status = await atlasGet(
      `${ATLAS_API_PATH}/groups/${projectId}/databaseUsers/admin/${user}`,
      publicKey, privateKey,
    );
    if (status === 200)     check('pass', `DB user ${user}`);
    else if (status === 404) check('fail', `DB user ${user}`, 'not found - run setup:db');
    else                     check('warn', `DB user ${user}`, `Atlas API returned HTTP ${status}`);
  }
}

// -- Entry point --------------------------------------------------------------─

export async function runValidate(): Promise<void> {
  console.log('=== Setup Validation ===');

  const envOk = checkEnvVars();
  if (!envOk) {
    console.log('\n[FAIL] Required environment variables missing - fix .env before continuing.\n');
    console.log(`=== Summary: ${pass} pass, ${fail} fail, ${warn} warn ===`);
    process.exitCode = 1;
    return;
  }

  const uri    = process.env.MONGODB_URI!;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    await checkMongoDB(client);
    await checkAtlas();
  } finally {
    await client.close();
  }

  console.log('');
  const status = fail > 0 ? '[FAIL]' : warn > 0 ? '[WARN]' : '[PASS]';
  console.log(`=== Summary: ${pass} pass, ${fail} fail, ${warn} warn - ${status} ===`);
  if (fail > 0) process.exitCode = 1;
}

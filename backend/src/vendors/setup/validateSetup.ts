import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import * as https from 'https';
import * as crypto from 'crypto';

dotenv.config({ path: resolve(__dirname, '../../../../.env') });

const ATLAS_API_BASE = 'cloud.mongodb.com';
const ATLAS_API_PATH = '/api/atlas/v2';

const EXPECTED_COLLECTIONS = [
  'party',
  'cardTransactionLog',
  'customerAgreementProcedure',
  'paymentCardManagement',
  'customerAuthenticationAssessment',
  'authenticationDomain',
  'partyAuthenticationAssessment',
  'fraudDiagnosisCase',
  'fraudDiagnosisCaseEvents',
  'customerCreditRatingState',
  'consentAgreement',
  'consentAccessLog',
];

// Unique index (primary ref field) per collection — representative index check
const EXPECTED_UNIQUE_INDEXES: Record<string, string> = {
  party:                            'partyInstanceReference',
  cardTransactionLog:               'cardTransactionInstanceReference',
  customerAgreementProcedure:       'customerAgreementInstanceReference',
  paymentCardManagement:            'paymentCardInstanceReference',
  customerAuthenticationAssessment: 'customerAuthenticationInstanceReference',
  fraudDiagnosisCase:               'fraudDiagnosisInstanceReference',
  partyAuthenticationAssessment:    'partyAuthenticationInstanceReference',
  authenticationDomain:             'partyAuthenticationDomainInstanceReference',
  customerCreditRatingState:        'customerCreditRatingInstanceReference',
  consentAgreement:                 'consentAgreementInstanceReference',
  consentAccessLog:                 'consentAccessLogInstanceReference',
};

// ── Result tracking ──────────────────────────────────────────────────────────

type Status = 'pass' | 'fail' | 'warn' | 'skip';

let pass = 0;
let fail = 0;
let warn = 0;

function check(status: Status, label: string, detail?: string) {
  const tag = status === 'pass' ? '[PASS]' : status === 'fail' ? '[FAIL]' : status === 'warn' ? '[WARN]' : '[SKIP]';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`  ${tag} ${label}${suffix}`);
  if (status === 'pass') pass++;
  else if (status === 'fail') fail++;
  else if (status === 'warn') warn++;
}

// ── HTTP Digest Auth helpers ─────────────────────────────────────────────────

function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}

function buildDigestHeader(
  publicKey: string, privateKey: string,
  method: string, path: string,
  realm: string, nonce: string, opaque?: string,
): string {
  const ha1      = md5(`${publicKey}:${realm}:${privateKey}`);
  const ha2      = md5(`${method}:${path}`);
  const cnonce   = crypto.randomBytes(8).toString('hex');
  const nc       = '00000001';
  const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
  const parts = [
    `Digest username="${publicKey}"`, `realm="${realm}"`, `nonce="${nonce}"`,
    `uri="${path}"`, `cnonce="${cnonce}"`, `nc=${nc}`, `qop=auth`, `response="${response}"`,
  ];
  if (opaque) parts.push(`opaque="${opaque}"`);
  return parts.join(', ');
}

function parseWwwAuthenticate(header: string) {
  const extract = (key: string) => header.match(new RegExp(`${key}="([^"]+)"`))?.[1] ?? '';
  return { realm: extract('realm'), nonce: extract('nonce'), opaque: header.match(/opaque="([^"]+)"/)?.[1] };
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

// ── Section checks ───────────────────────────────────────────────────────────

function checkEnvVars(): boolean {
  console.log('\n1. Environment variables');

  const kms = process.env.KMS_PROVIDER;

  // Core
  for (const v of ['MONGODB_URI', 'MONGODB_DB_NAME', 'KMS_PROVIDER', 'JWT_SECRET']) {
    process.env[v]
      ? check('pass', v, v === 'MONGODB_DB_NAME' ? process.env[v] : undefined)
      : check('fail', v, 'not set — required');
  }

  // KMS-specific
  if (kms === 'local') {
    process.env.LOCAL_MASTER_KEY_BASE64
      ? check('pass', 'LOCAL_MASTER_KEY_BASE64')
      : check('fail', 'LOCAL_MASTER_KEY_BASE64', 'not set — required for KMS_PROVIDER=local');
  } else if (kms === 'aws') {
    for (const v of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_CMK_ARN', 'AWS_REGION']) {
      process.env[v]
        ? check('pass', v)
        : check('fail', v, `not set — required for KMS_PROVIDER=aws`);
    }
  } else if (kms) {
    check('warn', 'KMS_PROVIDER', `unknown value '${kms}' — expected 'local' or 'aws'`);
  }

  // Role pool URIs
  for (const v of ['MONGODB_URI_LEVEL1', 'MONGODB_URI_LEVEL2']) {
    process.env[v]
      ? check('pass', v)
      : check('warn', v, 'not set — Level 1/2 role pools will fall back to main URI');
  }

  // Atlas API (optional, warn if missing)
  const hasAtlasKeys = !!(process.env.ATLAS_PUBLIC_KEY && process.env.ATLAS_PRIVATE_KEY && process.env.ATLAS_PROJECT_ID);
  for (const v of ['ATLAS_PUBLIC_KEY', 'ATLAS_PRIVATE_KEY', 'ATLAS_PROJECT_ID']) {
    process.env[v]
      ? check('pass', v)
      : check('warn', v, 'not set — Atlas role/user checks will be skipped');
  }
  for (const v of ['ATLAS_DB_USER_LEVEL1', 'ATLAS_DB_USER_LEVEL2']) {
    process.env[v]
      ? check('pass', v)
      : check('warn', v, 'not set — Atlas DB user checks will be skipped');
  }

  return fail === 0;
}

async function checkMongoDB(client: MongoClient): Promise<void> {
  const dbName = process.env.MONGODB_DB_NAME ?? 'pci_demo';

  // ── Connectivity ────────────────────────────────────────────────────────────
  console.log('\n2. MongoDB connectivity');

  try {
    await client.db().admin().ping();
    check('pass', 'main URI connected');
  } catch (e) {
    check('fail', 'main URI', `cannot connect — ${(e as Error).message}`);
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
      check('fail', key, `cannot connect — ${(e as Error).message}`);
    } finally {
      await c.close().catch(() => {});
    }
  }

  // ── Application database ────────────────────────────────────────────────────
  console.log(`\n3. Application database (${dbName})`);

  const db = client.db(dbName);
  const existing = await db.listCollections().toArray();
  const existingSet = new Set(existing.map((c) => c.name));

  const missing = EXPECTED_COLLECTIONS.filter((n) => !existingSet.has(n));
  const found   = EXPECTED_COLLECTIONS.length - missing.length;

  if (missing.length === 0) {
    check('pass', `collections — all ${EXPECTED_COLLECTIONS.length}/${EXPECTED_COLLECTIONS.length} present`);
  } else {
    check('fail', `collections — ${found}/${EXPECTED_COLLECTIONS.length} present`, `missing: ${missing.join(', ')}`);
  }

  // ── Indexes ─────────────────────────────────────────────────────────────────
  console.log('\n4. Indexes');

  for (const [col, field] of Object.entries(EXPECTED_UNIQUE_INDEXES)) {
    if (!existingSet.has(col)) {
      check('skip', `${col} — collection missing`);
      continue;
    }
    try {
      const indexes = await db.collection(col).listIndexes().toArray();
      const hasIt   = indexes.some((idx) => idx.key?.[field] !== undefined && idx.unique === true);
      hasIt
        ? check('pass', `${col} — unique index on ${field}`)
        : check('fail', `${col} — unique index on ${field} not found`);
    } catch (e) {
      check('warn', `${col} — index check error: ${(e as Error).message}`);
    }
  }

  // ── Key vault ───────────────────────────────────────────────────────────────
  console.log('\n5. QE key vault (encryption.__keyVault)');

  try {
    const kvDb      = client.db('encryption');
    const kvList    = await kvDb.listCollections({ name: '__keyVault' }).toArray();
    if (kvList.length === 0) {
      check('fail', '__keyVault collection', 'not found — run setup:db');
      return;
    }
    check('pass', '__keyVault collection exists');

    const dekCount = await kvDb.collection('__keyVault').countDocuments();
    dekCount > 0
      ? check('pass', `DEKs present — ${dekCount} key(s)`)
      : check('fail', 'DEKs', 'no DEKs found — run setup:db');

    const kvIndexes = await kvDb.collection('__keyVault').listIndexes().toArray();
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
    else if (status === 404) check('fail', `custom role ${role}`, 'not found — run setup:db');
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
    else if (status === 404) check('fail', `DB user ${user}`, 'not found — run setup:db');
    else                     check('warn', `DB user ${user}`, `Atlas API returned HTTP ${status}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runValidate(): Promise<void> {
  console.log('=== Setup Validation ===');

  const envOk = checkEnvVars();
  if (!envOk) {
    console.log('\n[FAIL] Required environment variables missing — fix .env before continuing.\n');
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
  console.log(`=== Summary: ${pass} pass, ${fail} fail, ${warn} warn — ${status} ===`);
  if (fail > 0) process.exitCode = 1;
}

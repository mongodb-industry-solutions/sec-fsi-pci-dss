/**
 * v2: Atlas Admin API automation for PCI DSS role-based connection pools.
 *
 * Creates two Atlas custom DB roles and two DB users during setup:
 *
 *   pci_level1_role  → FIND on all PCI collections
 *                      Paired with L1 QE client: sensitive QE:none fields stay Binary.
 *
 *   pci_level2_role  → FIND + UPDATE + INSERT on all PCI collections
 *                      Paired with L2 QE client: sensitive fields auto-decrypted by driver.
 *
 * Both roles cover the same collections - the QE encryptedFieldsMap tier (not RBAC) controls
 * what each user can actually read. The separate DB credentials produce distinct Atlas audit
 * log entries, satisfying PCI DSS Req 10 (non-repudiation per data-sensitivity tier).
 *
 * Required env vars (setup skipped gracefully when absent):
 *   ATLAS_PUBLIC_KEY              Atlas API public key
 *   ATLAS_PRIVATE_KEY             Atlas API private key
 *   ATLAS_PROJECT_ID              Atlas project/group ID
 *   MONGODB_DB_NAME               Database name (used for collection-level resources)
 *   ATLAS_DB_USER_LEVEL1          Username for the Level 1 DB user
 *   ATLAS_DB_USER_LEVEL1_PASSWORD Password for the Level 1 DB user
 *   ATLAS_DB_USER_LEVEL2          Username for the Level 2 DB user
 *   ATLAS_DB_USER_LEVEL2_PASSWORD Password for the Level 2 DB user
 */

import * as https from 'https';
import { buildDigestHeader, parseWwwAuthenticate } from '../encryption/digest';

const ATLAS_API_BASE = 'cloud.mongodb.com';
const ATLAS_API_PATH_BASE = '/api/atlas/v2';

// All PCI DSS collections covered by both roles
const PCI_COLLECTIONS = [
  'party',
  'customerAuthenticationAssessment',
  'customerAgreementProcedure',
  'paymentCardManagement',
  'cardTransactionLog',
  'fraudDiagnosisCase',
  'fraudDiagnosisCaseEvents',
];

interface AtlasAction {
  action: string;
  resources: { collection: string; db: string }[];
}

function buildActions(dbName: string, actions: string[]): AtlasAction[] {
  return actions.map((action) => ({
    action,
    resources: PCI_COLLECTIONS.map((col) => ({ collection: col, db: dbName })),
  }));
}

// -- Raw HTTPS request helper ------------------------------------------------─

function httpsRequest(
  method: string,
  path: string,
  body: unknown,
  authHeader?: string,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options: https.RequestOptions = {
      hostname: ATLAS_API_BASE,
      path,
      method,
      headers: {
        'Accept': 'application/vnd.atlas.2023-01-01+json',
        'Content-Type': 'application/json',
        ...(authHeader && { Authorization: authHeader }),
        ...(payload && { 'Content-Length': Buffer.byteLength(payload) }),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string | string[] | undefined>, body: data });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function atlasPost(
  path: string,
  body: unknown,
  publicKey: string,
  privateKey: string,
): Promise<{ status: number; body: unknown }> {
  // Step 1: unauthenticated probe to obtain Digest challenge
  const probe = await httpsRequest('POST', path, body);
  if (probe.status !== 401) {
    const parsed = JSON.parse(probe.body || '{}');
    return { status: probe.status, body: parsed };
  }

  const wwwAuth = (probe.headers['www-authenticate'] as string) ?? '';
  const challenge = parseWwwAuthenticate(wwwAuth);
  const authHeader = buildDigestHeader(publicKey, privateKey, 'POST', path, challenge.realm, challenge.nonce, challenge.opaque);

  // Step 2: authenticated request
  const res = await httpsRequest('POST', path, body, authHeader);
  let parsed: unknown;
  try { parsed = JSON.parse(res.body || '{}'); } catch { parsed = res.body; }
  return { status: res.status, body: parsed };
}

// -- Role + user creation ----------------------------------------------------─

async function upsertCustomRole(
  projectId: string,
  publicKey: string,
  privateKey: string,
  roleName: string,
  actions: AtlasAction[],
): Promise<void> {
  const path = `${ATLAS_API_PATH_BASE}/groups/${projectId}/customDBRoles`;
  const body = { roleName, actions, inheritedRoles: [] };
  const result = await atlasPost(path, body, publicKey, privateKey);

  if (result.status === 200 || result.status === 201) {
    console.log(`   custom role created: ${roleName}`);
  } else if (result.status === 409) {
    console.log(`   custom role already exists (skip): ${roleName}`);
  } else {
    console.warn(`   WARNING: custom role ${roleName} → HTTP ${result.status}`, result.body);
  }
}

async function upsertDbUser(
  projectId: string,
  publicKey: string,
  privateKey: string,
  username: string,
  password: string,
  roleName: string,
  dbName: string,
): Promise<void> {
  const path = `${ATLAS_API_PATH_BASE}/groups/${projectId}/databaseUsers`;
  const body = {
    username,
    password,
    databaseName: 'admin',
    roles: [{ roleName, databaseName: dbName }],
  };
  const result = await atlasPost(path, body, publicKey, privateKey);

  if (result.status === 200 || result.status === 201) {
    console.log(`   DB user created: ${username}`);
  } else if (result.status === 409) {
    console.log(`   DB user already exists (skip): ${username}`);
  } else {
    console.warn(`   WARNING: DB user ${username} → HTTP ${result.status}`, result.body);
  }
}

// -- Public entry point ------------------------------------------------------─

export async function createAtlasRoles(): Promise<void> {
  const publicKey  = process.env.ATLAS_PUBLIC_KEY;
  const privateKey = process.env.ATLAS_PRIVATE_KEY;
  const projectId  = process.env.ATLAS_PROJECT_ID;
  const dbName     = process.env.MONGODB_DB_NAME;

  if (!publicKey || !privateKey || !projectId || !dbName) {
    console.log('   ATLAS_PUBLIC_KEY / ATLAS_PRIVATE_KEY / ATLAS_PROJECT_ID not set - skipping Atlas role automation.');
    console.log('   Roles must be created manually in Atlas UI, or set those env vars and re-run setup.');
    return;
  }

  // Custom roles
  await upsertCustomRole(projectId, publicKey, privateKey, 'pci_level1_role',
    buildActions(dbName, ['FIND']));

  await upsertCustomRole(projectId, publicKey, privateKey, 'pci_level2_role',
    buildActions(dbName, ['FIND', 'UPDATE', 'INSERT']));

  // DB users
  const l1User  = process.env.ATLAS_DB_USER_LEVEL1;
  const l1Pass  = process.env.ATLAS_DB_USER_LEVEL1_PASSWORD;
  const l2User  = process.env.ATLAS_DB_USER_LEVEL2;
  const l2Pass  = process.env.ATLAS_DB_USER_LEVEL2_PASSWORD;

  if (l1User && l1Pass) {
    await upsertDbUser(projectId, publicKey, privateKey, l1User, l1Pass, 'pci_level1_role', dbName);
  } else {
    console.log('   ATLAS_DB_USER_LEVEL1 / PASSWORD not set - Level 1 DB user not created.');
  }

  if (l2User && l2Pass) {
    await upsertDbUser(projectId, publicKey, privateKey, l2User, l2Pass, 'pci_level2_role', dbName);
  } else {
    console.log('   ATLAS_DB_USER_LEVEL2 / PASSWORD not set - Level 2 DB user not created.');
  }
}

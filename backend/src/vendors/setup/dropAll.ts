import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import * as https from 'https';
import { buildBasicAuthHeader } from '../encryption/digest';
import { getKmsConfig } from '../encryption/kms';

dotenv.config({ path: resolve(__dirname, '../../../../.env') });

const ATLAS_API_BASE = 'cloud.mongodb.com';
const ATLAS_API_PATH = '/api/atlas/v2';

function warn(msg: string) {
  console.log(`  [WARN] ${msg}`);
}

function httpsDeleteRequest(
  path: string,
  authHeader?: string,
): Promise<{ status: number; wwwAuthenticate?: string }> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: ATLAS_API_BASE,
      path,
      method: 'DELETE',
      headers: {
        'Accept': 'application/vnd.atlas.2023-01-01+json',
        ...(authHeader && { Authorization: authHeader }),
      },
    };
    const req = https.request(options, (res) => {
      res.resume();
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          wwwAuthenticate: res.headers['www-authenticate'] as string | undefined,
        })
      );
    });
    req.on('error', reject);
    req.end();
  });
}

async function atlasDelete(
  path: string,
  publicKey: string,
  privateKey: string,
  label: string,
): Promise<void> {
  try {
    const authHeader = buildBasicAuthHeader(publicKey, privateKey);
    const res = await httpsDeleteRequest(path, authHeader);

    if (res.status === 200 || res.status === 204) {
      console.log(`  deleted: ${label}`);
    } else if (res.status === 404) {
      warn(`${label} - not found in Atlas, skipping`);
    } else {
      warn(`${label} - HTTP ${res.status}, may need manual deletion in Atlas UI`);
    }
  } catch (e) {
    warn(`${label} - ${(e as Error).message}`);
  }
}

async function dropAtlasRolesAndUsers(): Promise<void> {
  const publicKey = process.env.ATLAS_PUBLIC_KEY;
  const privateKey = process.env.ATLAS_PRIVATE_KEY;
  const projectId = process.env.ATLAS_PROJECT_ID;

  if (!publicKey || !privateKey || !projectId) {
    warn('ATLAS_PUBLIC_KEY / ATLAS_PRIVATE_KEY / ATLAS_PROJECT_ID not set - skipping Atlas cleanup.');
    warn('Delete manually in Atlas UI: roles pci_level1_role, pci_level2_role and the Level 1/2 DB users.');
    return;
  }

  for (const role of ['pci_level1_role', 'pci_level2_role']) {
    await atlasDelete(
      `${ATLAS_API_PATH}/groups/${projectId}/customDBRoles/roleName/${role}`,
      publicKey, privateKey,
      `custom role ${role}`,
    );
  }

  const users = [
    process.env.ATLAS_DB_USER_LEVEL1,
    process.env.ATLAS_DB_USER_LEVEL2,
  ].filter(Boolean) as string[];

  if (users.length === 0) {
    warn('ATLAS_DB_USER_LEVEL1 / ATLAS_DB_USER_LEVEL2 not set - skipping DB user deletion.');
  }
  for (const user of users) {
    await atlasDelete(
      `${ATLAS_API_PATH}/groups/${projectId}/databaseUsers/admin/${user}`,
      publicKey, privateKey,
      `DB user ${user}`,
    );
  }
}

export async function runDrop(): Promise<void> {

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set.\n' +
      '  Copy .env.example to .env and fill in MONGODB_URI.'
    );
  }

  const dbName = process.env.MONGODB_DB_NAME ?? 'pci_demo';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log(`Connected - dropping database '${dbName}'\n`);
    console.log('WARNING: This operation is irreversible. All data will be lost.\n');
    const kmsConfig = getKmsConfig();
    const db = client.db(dbName);

    // 1. Drop entire application database (collections + indexes included)
    console.log(`1. Dropping database '${dbName}'...`);
    try {
      const dbList = await client.db().admin().listDatabases({ nameOnly: true });
      const exists = dbList.databases.some((d: { name: string }) => d.name === dbName);
      if (exists) {
        await db.dropDatabase();
        console.log(`  dropped: database '${dbName}'`);
      } else {
        warn(`database '${dbName}' - not found, skipping`);
      }
    } catch (e) {
      warn(`database '${dbName}' - drop failed: ${(e as Error).message}, continuing`);
    }
    console.log('');

    // 2. Drop QE key vault database (encryption.__keyVault + the encryption db itself)
    console.log('2. Dropping QE key vault database (encryption)...');
    try {
      const dbList2 = await client.db().admin().listDatabases({ nameOnly: true });
      const kvExists = dbList2.databases.some((d: { name: string }) => d.name === kmsConfig.database);
      if (kvExists) {
        await client.db(kmsConfig.database).dropDatabase();
        console.log(`  dropped: database '${kmsConfig.database}'`);
      } else {
        warn(`database '${kmsConfig.database}' - not found, skipping`);
      }
    } catch (e) {
      warn(`key vault - drop failed: ${(e as Error).message}, continuing`);
    }
    console.log('');

    // 3. Delete Atlas custom roles and DB users
    console.log('3. Deleting Atlas custom roles and DB users...');
    await dropAtlasRolesAndUsers();
    console.log('');

    console.log('Drop complete. The database is now clean.');
    console.log('  Re-provision: npm run setup:db');
    console.log('  Re-seed:      npm run setup:seed');
  } finally {
    await client.close();
  }
}

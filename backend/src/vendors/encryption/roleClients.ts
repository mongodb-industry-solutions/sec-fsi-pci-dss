/**
 * v2: Role-aware QE client pools.
 *
 * Two MongoClient instances are maintained — one per DEK tier:
 *
 *   Level 1 pool (qeClientL1):
 *     encryptedFieldsMap includes only QE:equality (lookup) fields.
 *     Sensitive QE:none fields are NOT in the map → driver returns Binary ciphertext.
 *     The service layer detects Binary values via isSensitiveDecrypted() and omits them.
 *
 *   Level 2 pool (qeClientL2):
 *     encryptedFieldsMap includes ALL fields (equality + QE:none sensitive).
 *     Driver auto-decrypts every encrypted field before the service sees the document.
 *
 * Connection strings per pool are driven by env vars:
 *   MONGODB_URI_LEVEL1  — connection string for the Atlas DB user with pci_level1_role
 *   MONGODB_URI_LEVEL2  — connection string for the Atlas DB user with pci_level2_role
 *   MONGODB_URI         — fallback for both pools when role-specific URIs are not set
 *
 * In KMS_PROVIDER=local (offline demo) mode both pools use the same local URI and
 * the DEK tier distinction is still enforced at the encryptedFieldsMap level.
 */

import { MongoClient, Db } from 'mongodb';
import { buildKmsProviders } from './kms';
import { buildEncryptedFieldsMaps } from './encryptedFieldsMaps';
import { provisionDataEncryptionKeys } from './keyVault';
import { resolveCryptLibOptions } from './cryptLib';
import { canReadSensitive } from '../middleware/rbac';
import type { UserRole } from '../../shared/models/identity.model';

const KEY_VAULT_NAMESPACE = 'encryption.__keyVault';

let _l1Client: MongoClient | null = null;
let _l2Client: MongoClient | null = null;

async function buildQEClient(uri: string, tier: 'level1' | 'level2'): Promise<MongoClient> {
  // Resolve DEKs using a plain (non-QE) connection first.
  // Short timeouts so the Fastify plugin fails fast when MongoDB is unreachable.
  const plainClient = new MongoClient(process.env.MONGODB_URI!, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  await plainClient.connect();
  const deks = await provisionDataEncryptionKeys(plainClient);
  await plainClient.close();

  const maps = buildEncryptedFieldsMaps(deks, tier);
  const dbName = process.env.MONGODB_DB_NAME!;
  const cryptLib = resolveCryptLibOptions();

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    autoEncryption: {
      keyVaultNamespace: KEY_VAULT_NAMESPACE,
      kmsProviders: buildKmsProviders(),
      encryptedFieldsMap: {
        [`${dbName}.party`]:                            maps.party,
        [`${dbName}.cardTransactionLog`]:               maps.cardTransactionLog,
        [`${dbName}.customerAgreementProcedure`]:       maps.customerAgreementProcedure,
        [`${dbName}.paymentCardManagement`]:            maps.paymentCardManagement,
        [`${dbName}.customerAuthenticationAssessment`]: maps.customerAuthenticationAssessment,
      },
      extraOptions: {
        ...(cryptLib.cryptSharedLibPath && { cryptSharedLibPath: cryptLib.cryptSharedLibPath }),
        cryptSharedLibRequired: cryptLib.cryptSharedLibRequired,
      },
    },
  });

  await client.connect();
  return client;
}

export async function getL1QEClient(): Promise<MongoClient> {
  if (_l1Client) return _l1Client;
  const uri = process.env.MONGODB_URI_LEVEL1 ?? process.env.MONGODB_URI!;
  _l1Client = await buildQEClient(uri, 'level1');
  return _l1Client;
}

export async function getL2QEClient(): Promise<MongoClient> {
  if (_l2Client) return _l2Client;
  const uri = process.env.MONGODB_URI_LEVEL2 ?? process.env.MONGODB_URI!;
  _l2Client = await buildQEClient(uri, 'level2');
  return _l2Client;
}

/**
 * Returns a role-aware Db instance.
 * Level 2 investigator requires a valid escalation token; security_auditor never does.
 * All other roles receive the Level 1 (lookup-only) QE client.
 */
export async function getDbForRole(role: UserRole, hasValidToken = false): Promise<Db> {
  const useL2 = canReadSensitive(role, hasValidToken);
  const client = useL2 ? await getL2QEClient() : await getL1QEClient();
  return client.db(process.env.MONGODB_DB_NAME!);
}

export async function closeRoleClients(): Promise<void> {
  if (_l1Client) { await _l1Client.close(); _l1Client = null; }
  if (_l2Client) { await _l2Client.close(); _l2Client = null; }
}

/**
 * v2: Role-aware QE client pools.
 *
 * Two MongoClient instances are maintained - one per DEK tier:
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
 *   MONGODB_URI_LEVEL1  - connection string for the Atlas DB user with pci_level1_role
 *   MONGODB_URI_LEVEL2  - connection string for the Atlas DB user with pci_level2_role
 *   MONGODB_URI         - fallback for both pools when role-specific URIs are not set
 *
 * In PSP_KMS_PROVIDER=local (offline demo) mode both pools use the same local URI and
 * the DEK tier distinction is still enforced at the encryptedFieldsMap level.
 */

import { MongoClient, Db } from 'mongodb';
import { buildKmsProviders, getKmsConfig } from './kms';
import { buildEncryptedFieldsMaps } from './encryptedFieldsMaps';
import { provisionDataEncryptionKeys } from './keyVault';
import { resolveCryptLibOptions } from './cryptLib';
import { canReadSensitive } from '../middleware/rbac';
import type { UserRole } from '../../shared/models/identity.model';
import { config } from '../../config';

const kmsConfig = getKmsConfig();

let _l1Client: MongoClient | null = null;
let _l2Client: MongoClient | null = null;
// In-flight builds. Constructing a QE MongoClient is expensive (crypt_shared load, DEK
// provisioning, connection) and takes seconds. Without single-flight, concurrent requests
// arriving during cold start each see a null client and build their OWN encrypted client
// (repeated "[crypt] Using library ..." logs + duplicate connections + 30 to 60s pile-ups).
// Caching the in-flight promise ensures the client is built exactly once per process.
let _l1Building: Promise<MongoClient> | null = null;
let _l2Building: Promise<MongoClient> | null = null;

async function buildQEClient(uri: string, tier: 'level1' | 'level2'): Promise<MongoClient> {
  const plainClient = new MongoClient(config.mongodb.uri, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  await plainClient.connect();
  const deks = await provisionDataEncryptionKeys(plainClient);
  await plainClient.close();

  const maps = buildEncryptedFieldsMaps(deks, tier);
  const dbName = config.mongodb.dbName;
  const cryptLib = resolveCryptLibOptions();

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    autoEncryption: {
      keyVaultNamespace: kmsConfig.namespace,
      kmsProviders: buildKmsProviders(),
      encryptedFieldsMap: {
        [`${dbName}.party`]:                            maps.party,
        [`${dbName}.cardTransactionLog`]:               maps.cardTransactionLog,
        [`${dbName}.customerAgreementProcedure`]:       maps.customerAgreementProcedure,
        [`${dbName}.paymentCardManagement`]:            maps.paymentCardManagement,
        [`${dbName}.customerAuthenticationAssessment`]: maps.customerAuthenticationAssessment,
        // IBAN/routing are QE:none (level2 only), level1 map omits this entry entirely
        ...(maps.payoutAccountArrangement
          ? { [`${dbName}.payoutAccountArrangement`]: maps.payoutAccountArrangement }
          : {}),
        // destinationIban (unregistered external destination) QE:none, level2 only
        ...(maps.paymentExecutionProcedure
          ? { [`${dbName}.paymentExecutionProcedure`]: maps.paymentExecutionProcedure }
          : {}),
      },
      extraOptions: {
        // v7 types cryptSharedLibPath as a `${string}mongo_crypt_v${number}.{so,dll,dylib}`
        // template literal. The path is resolved/validated at runtime in cryptLib, so cast here.
        ...(cryptLib.cryptSharedLibPath && {
          cryptSharedLibPath: cryptLib.cryptSharedLibPath as
            | `${string}mongo_crypt_v${number}.so`
            | `${string}mongo_crypt_v${number}.dll`
            | `${string}mongo_crypt_v${number}.dylib`,
        }),
        cryptSharedLibRequired: cryptLib.cryptSharedLibRequired,
      },
    },
  });

  await client.connect();
  return client;
}

export async function getL1QEClient(): Promise<MongoClient> {
  if (_l1Client) return _l1Client;
  if (!_l1Building) {
    const uri = config.mongodb.uriLevel1 ?? config.mongodb.uri;
    _l1Building = buildQEClient(uri, 'level1')
      .then((c) => { _l1Client = c; return c; })
      .finally(() => { _l1Building = null; });
  }
  return _l1Building;
}

export async function getL2QEClient(): Promise<MongoClient> {
  if (_l2Client) return _l2Client;
  if (!_l2Building) {
    const uri = config.mongodb.uriLevel2 ?? config.mongodb.uri;
    _l2Building = buildQEClient(uri, 'level2')
      .then((c) => { _l2Client = c; return c; })
      .finally(() => { _l2Building = null; });
  }
  return _l2Building;
}

/**
 * Returns a role-aware Db instance.
 * Level 2 investigator requires a valid escalation token; security_auditor never does.
 * All other roles receive the Level 1 (lookup-only) QE client.
 */
export async function getDbForRole(role: UserRole, hasValidToken = false): Promise<Db> {
  const useL2 = canReadSensitive(role, hasValidToken);
  const client = useL2 ? await getL2QEClient() : await getL1QEClient();
  return client.db(config.mongodb.dbName);
}

/** Level 2 Db for a caller that has passed a named capability check (e.g. canRevealKycSensitive). */
export async function getSensitiveTierDb(capability: string): Promise<Db> {
  if (!capability) throw new Error('getSensitiveTierDb requires the granting capability name');
  const client = await getL2QEClient();
  return client.db(config.mongodb.dbName);
}

/** Db for a write that must encrypt QE:none fields. Not a disclosure: nothing is returned. */
export async function getEncryptionWriteDb(reason: string): Promise<Db> {
  if (!reason) throw new Error('getEncryptionWriteDb requires the reason for needing the full map');
  const client = await getL2QEClient();
  return client.db(config.mongodb.dbName);
}

export async function closeRoleClients(): Promise<void> {
  // Wait for any in-flight build to settle FIRST so we don't leak a client that finishes
  // constructing after teardown (its .then sets _l1Client/_l2Client). Capture the promises, let
  // them resolve, then close whatever ended up assigned (hot-reload rebuilds fresh clients after).
  const inFlight = [_l1Building, _l2Building].filter((p): p is Promise<MongoClient> => p !== null);
  _l1Building = null;
  _l2Building = null;
  if (inFlight.length) await Promise.allSettled(inFlight);
  if (_l1Client) { await _l1Client.close(); _l1Client = null; }
  if (_l2Client) { await _l2Client.close(); _l2Client = null; }
}

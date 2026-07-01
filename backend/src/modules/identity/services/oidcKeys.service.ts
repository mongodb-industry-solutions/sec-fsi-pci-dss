import { Db } from 'mongodb';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createOAuthKeyProvider, OAuthKeyProvider } from './oauthKeyProviders/index';
import {
  PARTY_AUTHENTICATION_KEY_COLLECTION,
  PartyAuthenticationKeyRecord,
  AuthKeyStatus,
} from '../models/partyAuthenticationKey.model';

let _provider: OAuthKeyProvider | null = null;

export function getOAuthKeyProvider(): OAuthKeyProvider {
  if (!_provider) throw new Error('OAuthKeyProvider not initialised — call initOidcKeys() at startup');
  return _provider;
}

export async function initOidcKeys(db: Db): Promise<void> {
  _provider = createOAuthKeyProvider();

  // Ensure public key is synced to Atlas (upsert by kid, keyStatus: active)
  const jwk = await _provider.getPublicKeyJwk();
  const kid = _provider.getKid();

  // Derive PEM from JWK for storage
  const pubKeyObj = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
  const publicKeyPem = pubKeyObj.export({ type: 'spki', format: 'pem' }) as string;

  const col = db.collection<PartyAuthenticationKeyRecord>(PARTY_AUTHENTICATION_KEY_COLLECTION);

  const existing = await col.findOne({ keyId: kid });
  if (!existing) {
    const record: PartyAuthenticationKeyRecord = {
      keyId: kid,
      keyStatus: 'active',
      keyAlgorithm: 'RS256',
      keyModulusLength: 2048,
      publicKeyPem,
      keyCreatedDateTime: new Date(),
      bianServiceDomain: 'PartyAuthentication',
      bianControlRecordType: 'AuthenticationKey',
      schemaVersion: 1,
    };
    await col.insertOne(record);
    console.log(`[oauth-keys] Registered public key kid=${kid} in partyAuthenticationKey`);
  }

  // Ensure no other key is still marked active (idempotent on restart)
  await col.updateMany(
    { keyId: { $ne: kid }, keyStatus: 'active' },
    { $set: { keyStatus: 'deprecated' as AuthKeyStatus, keyDeprecatedAt: new Date() } }
  );
}

export async function getJwks(db: Db): Promise<{ keys: JsonWebKey[] }> {
  const col = db.collection<PartyAuthenticationKeyRecord>(PARTY_AUTHENTICATION_KEY_COLLECTION);
  const keys = await col.find({ keyStatus: { $in: ['active', 'deprecated'] } }).toArray();
  return {
    keys: keys.map((k) => {
      const obj = crypto.createPublicKey(k.publicKeyPem);
      const jwk = obj.export({ format: 'jwk' }) as JsonWebKey;
      return { ...jwk, use: 'sig', alg: 'RS256', kid: k.keyId };
    }),
  };
}

export async function generateAndActivateKey(
  db: Db,
  createdByPartyReference?: string
): Promise<{ kid: string; publicKeyPem: string }> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const pubKeyObj = crypto.createPublicKey(publicKey as string);
  const der = pubKeyObj.export({ type: 'spki', format: 'der' }) as Buffer;
  const kid = crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);

  const col = db.collection<PartyAuthenticationKeyRecord>(PARTY_AUTHENTICATION_KEY_COLLECTION);

  // Deprecate current active key(s)
  await col.updateMany(
    { keyStatus: 'active' },
    { $set: { keyStatus: 'deprecated' as AuthKeyStatus, keyDeprecatedAt: new Date() } }
  );

  const record: PartyAuthenticationKeyRecord = {
    keyId: kid,
    keyStatus: 'active',
    keyAlgorithm: 'RS256',
    keyModulusLength: 2048,
    publicKeyPem: publicKey as string,
    keyCreatedDateTime: new Date(),
    createdByPartyReference,
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'AuthenticationKey',
    schemaVersion: 1,
  };
  await col.insertOne(record);

  // Reinitialise the in-process provider to the new key
  const newProvider = createOAuthKeyProvider();
  // For local provider: the new key file was written externally; re-read it.
  // For AWS: the ARN determines the key; rotation happens inside KMS.
  _provider = newProvider;

  return { kid, publicKeyPem: publicKey as string };
}

export async function rotateKey(
  db: Db,
  gracePeriodHours: number = 24,
  createdByPartyReference?: string
): Promise<{ kid: string; publicKeyPem: string }> {
  return generateAndActivateKey(db, createdByPartyReference);
}

export async function revokeKey(db: Db, keyId: string): Promise<void> {
  const col = db.collection<PartyAuthenticationKeyRecord>(PARTY_AUTHENTICATION_KEY_COLLECTION);
  const key = await col.findOne({ keyId });
  if (!key) throw Object.assign(new Error(`Key ${keyId} not found`), { statusCode: 404 });
  if (key.keyStatus === 'active') {
    throw Object.assign(new Error('Cannot revoke the active signing key — rotate first'), { statusCode: 400 });
  }
  await col.updateOne({ keyId }, { $set: { keyStatus: 'revoked' as AuthKeyStatus, keyRevokedAt: new Date() } });
}

export async function uploadKey(
  db: Db,
  privateKeyPem: string,
  publicKeyPem: string,
  createdByPartyReference?: string
): Promise<{ kid: string }> {
  // Validate PEM pair
  const privKey = crypto.createPrivateKey(privateKeyPem);
  const pubKey = crypto.createPublicKey(publicKeyPem);
  const der = pubKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const kid = crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);

  const col = db.collection<PartyAuthenticationKeyRecord>(PARTY_AUTHENTICATION_KEY_COLLECTION);
  await col.updateMany(
    { keyStatus: 'active' },
    { $set: { keyStatus: 'deprecated' as AuthKeyStatus, keyDeprecatedAt: new Date() } }
  );

  const record: PartyAuthenticationKeyRecord = {
    keyId: kid,
    keyStatus: 'active',
    keyAlgorithm: 'RS256',
    keyModulusLength: 2048,
    publicKeyPem,
    keyCreatedDateTime: new Date(),
    createdByPartyReference,
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'AuthenticationKey',
    schemaVersion: 1,
  };
  await col.insertOne(record);
  return { kid };
}

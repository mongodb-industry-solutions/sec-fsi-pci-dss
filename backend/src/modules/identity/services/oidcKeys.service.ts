import { Db } from 'mongodb';
import * as crypto from 'crypto';
import { createOAuthKeyProvider, OAuthKeyProvider } from './oauthKeyProviders/index';
import {
  PARTY_AUTHENTICATION_KEY_COLLECTION,
  PartyAuthenticationKeyRecord,
  AuthKeyStatus,
} from '../models/partyAuthenticationKey.model';

/**
 * ADR-036 (FS-first): the OAuthKeyProvider (local filesystem or AWS KMS) is the single
 * source of truth for key material. The partyAuthenticationKey collection is an audit
 * mirror — it records who rotated a key and when, and drives the admin dashboard listing.
 * It is NEVER read to verify tokens or to build the JWKS; those come from the provider.
 */

let _provider: OAuthKeyProvider | null = null;

export function getOAuthKeyProvider(): OAuthKeyProvider {
  if (!_provider) throw new Error('OAuthKeyProvider not initialised — call initOidcKeys() at startup');
  return _provider;
}

// ── Audit mirror helpers ────────────────────────────────────────────────────

async function upsertAuditRecord(
  db: Db,
  kid: string,
  publicKeyPem: string,
  status: AuthKeyStatus,
  createdByPartyReference?: string,
): Promise<void> {
  const col = db.collection<PartyAuthenticationKeyRecord>(PARTY_AUTHENTICATION_KEY_COLLECTION);
  const existing = await col.findOne({ keyId: kid });
  if (existing) {
    const patch: Partial<PartyAuthenticationKeyRecord> = { keyStatus: status };
    if (status === 'deprecated' && !existing.keyDeprecatedAt) patch.keyDeprecatedAt = new Date();
    if (status === 'revoked' && !existing.keyRevokedAt) patch.keyRevokedAt = new Date();
    await col.updateOne({ keyId: kid }, { $set: patch });
    return;
  }
  await col.insertOne({
    keyId: kid,
    keyStatus: status,
    keyAlgorithm: 'RS256',
    keyModulusLength: 2048,
    publicKeyPem,
    keyCreatedDateTime: new Date(),
    ...(createdByPartyReference && { createdByPartyReference }),
    bianServiceDomain: 'PartyAuthentication',
    bianControlRecordType: 'AuthenticationKey',
    schemaVersion: 1,
  });
}

/** Reconcile the audit mirror with the provider's current key set. */
async function syncAuditMirror(db: Db, createdByPartyReference?: string): Promise<void> {
  const provider = getOAuthKeyProvider();
  const keys = await provider.listPublicKeys();
  const liveKids = new Set(keys.map((k) => k.kid));

  for (const k of keys) {
    await upsertAuditRecord(db, k.kid, k.publicKeyPem, k.status, createdByPartyReference);
  }

  // Any DB record still marked active/deprecated that the provider no longer serves is now revoked.
  const col = db.collection<PartyAuthenticationKeyRecord>(PARTY_AUTHENTICATION_KEY_COLLECTION);
  const stale = await col.find({ keyStatus: { $in: ['active', 'deprecated'] } }).toArray();
  for (const rec of stale) {
    if (!liveKids.has(rec.keyId)) {
      await col.updateOne(
        { keyId: rec.keyId },
        { $set: { keyStatus: 'revoked' as AuthKeyStatus, keyRevokedAt: new Date() } },
      );
    }
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export async function initOidcKeys(db: Db): Promise<void> {
  _provider = createOAuthKeyProvider();
  // Warm the KMS provider so getKid() is available, then mirror to the audit collection.
  await _provider.getPublicKeyJwk();
  await syncAuditMirror(db);
  console.log(`[oauth-keys] Active signing kid=${_provider.getKid()} (provider: ${_provider.supportsRotation() ? 'local' : 'aws-kms'})`);
}

// ── JWKS (served from the provider, not the DB) ─────────────────────────────

export async function getJwks(): Promise<{ keys: JsonWebKey[] }> {
  const provider = getOAuthKeyProvider();
  const keys = await provider.listPublicKeys();
  return {
    keys: keys.map((k) => {
      const jwk = crypto.createPublicKey(k.publicKeyPem).export({ format: 'jwk' }) as JsonWebKey;
      return { ...jwk, use: 'sig', alg: 'RS256', kid: k.kid };
    }),
  };
}

/** Public key PEM for a kid (active or in grace), or null. Backs GET /keys/:kid/public.pem. */
export async function getPublicPemByKid(kid: string): Promise<string | null> {
  return getOAuthKeyProvider().getPublicPemByKid(kid);
}

// ── Management (writes to the provider, then mirrors to the audit collection) ─

export async function generateAndActivateKey(
  db: Db,
  createdByPartyReference?: string,
): Promise<{ kid: string; publicKeyPem: string }> {
  const provider = getOAuthKeyProvider();
  const result = await provider.rotate();
  await syncAuditMirror(db, createdByPartyReference);
  return result;
}

export async function rotateKey(
  db: Db,
  _gracePeriodHours = 24,
  createdByPartyReference?: string,
): Promise<{ kid: string; publicKeyPem: string }> {
  return generateAndActivateKey(db, createdByPartyReference);
}

export async function uploadKey(
  db: Db,
  privateKeyPem: string,
  publicKeyPem: string,
  createdByPartyReference?: string,
): Promise<{ kid: string }> {
  const provider = getOAuthKeyProvider();
  const result = await provider.importKeypair(privateKeyPem, publicKeyPem);
  await syncAuditMirror(db, createdByPartyReference);
  return { kid: result.kid };
}

export async function revokeKey(db: Db, keyId: string): Promise<void> {
  const provider = getOAuthKeyProvider();
  await provider.revoke(keyId); // throws 400 for the active key, 404 for unknown
  await upsertAuditRecord(
    db,
    keyId,
    (await db
      .collection<PartyAuthenticationKeyRecord>(PARTY_AUTHENTICATION_KEY_COLLECTION)
      .findOne({ keyId }))?.publicKeyPem ?? '',
    'revoked',
  );
}

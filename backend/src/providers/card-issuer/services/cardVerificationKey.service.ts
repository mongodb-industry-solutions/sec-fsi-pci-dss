// Card Verification Key (CVK) + per-card CVV derivation for the built-in card-issuer module.
//
// PCI DSS Req 3.2: the CVV/CVV2 is Sensitive Authentication Data and is NEVER stored (not in
// cleartext, not encrypted). A real issuer recomputes it inside an HSM from the card data plus a
// secret issuer key. This module reproduces that model: the CVV is DERIVED on demand from
// HMAC-SHA256(CVK, cardToken | expiryMMYY | serviceCode) and never persisted.
//
// The CVK is the issuer secret (analogous to the HSM-resident CVK). It is key material owned by
// this module and is stored ENCRYPTED using envelope encryption (KMS/master -> DEK -> CVK): a
// random CVK is wrapped by the local KMS provider (the same CMK surface as Queryable Encryption)
// and persisted in the key vault. The cleartext CVK only ever lives in process memory.
import { Binary, MongoClient } from 'mongodb';
import { createHmac, hkdfSync } from 'node:crypto';
import { LocalKmsKeyProvider, KmsKeyProvider, buildKmsKeyProvider } from '../../../vendors/encryption/chdCrypto';
import { getKmsConfig } from '../../../vendors/encryption/kms';
import { getRawClient } from '../../../vendors/encryption/rawClient';

const CVK_KEY_ALT_NAME = 'card-issuer-cvk';
const CVK_PURPOSE = 'card-issuer-cvk';
const CVK_BYTES = 32;

// The wrapped-CVK record lives alongside the QE DEKs in the key vault collection. It is NOT a QE
// DEK (no keyMaterial/masterKey): the driver ignores it. It carries the CMK-wrapped CVK blob so the
// envelope chain (master -> wrappedDEK -> CVK) is auditable and reproducible.
interface CvkRecord {
  keyAltNames: string[];
  purpose: string;
  cvkKeyId: string;
  cvkWrapped: Binary;
  kid: string;
  provider: string;
  recordCreatedDateTime: Date;
}

function keyVaultColl(client: MongoClient) {
  const cfg = getKmsConfig();
  return client.db(cfg.database).collection<CvkRecord>(cfg.collection);
}

// Idempotent provisioning: create the wrapped CVK once, reuse it on every subsequent run. Called
// from setup/seed (the only source of truth for key material). Returns the CVK key id reference
// (a stable, non-secret identifier suitable to store on module-owned records).
export async function provisionCardIssuerCvk(client: MongoClient): Promise<string> {
  const coll = keyVaultColl(client);
  const existing = await coll.findOne({ keyAltNames: CVK_KEY_ALT_NAME });
  if (existing) {
    console.log(`    reuse: ${CVK_KEY_ALT_NAME}`);
    return existing.cvkKeyId;
  }
  const kms = buildKmsKeyProvider() as unknown as KmsKeyProvider;
  if (!(kms instanceof LocalKmsKeyProvider)) {
    throw new Error('CVK provisioning requires the local KMS provider in this environment');
  }
  // Mint a DEK via the KMS (master/CMK wraps the DEK). Persist ONLY the CMK-wrapped DEK; the CVK is
  // later derived from the DEK cleartext (HKDF), so the CVK itself is never stored (envelope chain
  // master -> wrappedDEK -> CVK). generateDataKey returns the fresh DEK + its wrapped form.
  const { dek, wrappedDEK, kid } = await kms.generateDataKey();
  dek.fill(0);
  const cvkKeyId = `cvk-${CVK_KEY_ALT_NAME}`;
  await coll.insertOne({
    keyAltNames: [CVK_KEY_ALT_NAME],
    purpose: CVK_PURPOSE,
    cvkKeyId,
    cvkWrapped: new Binary(wrappedDEK),
    kid,
    provider: getKmsConfig().provider,
    recordCreatedDateTime: new Date(),
  });
  console.log(`    new:   ${CVK_KEY_ALT_NAME}`);
  return cvkKeyId;
}

let cvkCache: Buffer | null = null;

// Resolve the cleartext CVK: load the wrapped DEK from the key vault, unwrap it via the KMS, and
// derive the CVK by HKDF. Cached in memory for the process lifetime. Throws if not provisioned.
// Reads the key vault through the raw client (the vault is a sibling `encryption` database).
export async function getCardIssuerCvk(): Promise<Buffer> {
  if (cvkCache) return cvkCache;
  const client = await getRawClient();
  const rec = await keyVaultColl(client).findOne({ keyAltNames: CVK_KEY_ALT_NAME });
  if (!rec) throw new Error('card-issuer CVK not provisioned (run setup/seed)');
  const kms = buildKmsKeyProvider() as unknown as KmsKeyProvider;
  const dek = await kms.unwrapDataKey(Buffer.from(rec.cvkWrapped.buffer), rec.kid);
  // Derive the CVK from the DEK cleartext (second envelope hop). CVK never at rest.
  const cvk = Buffer.from(hkdfSync('sha256', dek, Buffer.alloc(0), Buffer.from(CVK_PURPOSE), CVK_BYTES));
  dek.fill(0);
  cvkCache = cvk;
  return cvk;
}

// Reset the in-memory cache (tests).
export function resetCvkCache(): void {
  if (cvkCache) cvkCache.fill(0);
  cvkCache = null;
}

// Per-card CVV derivation (deterministic). Mirrors an issuer HSM recomputation:
//   cvv = digits( HMAC-SHA256(CVK, token | expiryMMYY | serviceCode) )[0:cvvLength]
// Inputs are non-SAD (token surrogate, expiry, service code). The output is ephemeral.
export function derivePerCardCvv(
  cvk: Buffer,
  args: { cardToken: string; expiryMMYY: string; serviceCode: string; cvvLength: number },
): string {
  const msg = `${args.cardToken}|${normalizeExpiry(args.expiryMMYY)}|${args.serviceCode}`;
  const mac = createHmac('sha256', cvk).update(msg, 'utf8').digest();
  // Map the MAC bytes to decimal digits, then take the leading cvvLength digits.
  let digits = '';
  for (let i = 0; i < mac.length && digits.length < args.cvvLength; i++) {
    digits += (mac[i] % 10).toString();
  }
  // Guarantee full length even for cvvLength > mac-derived digits (never happens for 3/4).
  while (digits.length < args.cvvLength) digits += '0';
  return digits.slice(0, args.cvvLength);
}

// Normalize an expiry to MMYY for a stable derivation input. Accepts MM/YY or MM/YYYY.
export function normalizeExpiry(expiry: string): string {
  const m = (expiry ?? '').trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m) return (expiry ?? '').replace(/\D/g, '').slice(0, 4);
  const mm = m[1].padStart(2, '0');
  const yy = m[2].length === 4 ? m[2].slice(2) : m[2];
  return `${mm}${yy}`;
}

// Default service code when the issuer PAN vault is inactive (demo simple, zero CHD). A 3-digit
// code (international interchange, normal authorization, no restrictions).
export const DEFAULT_SERVICE_CODE = '201';

// Convenience: resolve the CVK and derive the per-card CVV in one call.
export async function computePerCardCvv(
  args: { cardToken: string; expiryMMYY: string; serviceCode: string; cvvLength: number },
): Promise<string> {
  const cvk = await getCardIssuerCvk();
  return derivePerCardCvv(cvk, args);
}

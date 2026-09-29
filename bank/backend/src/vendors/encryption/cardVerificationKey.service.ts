// The issuer's card verification key, and the per-card CVV derived from it.
//
// A CVV is sensitive authentication data and is never stored in any form. A real issuer recomputes it in an
// HSM from the card data plus a secret key, which is reproduced here: the value is derived on demand as
// HMAC-SHA256(key, cardToken | expiryMMYY | serviceCode).
//
// v37 P7 moved this from the PSP to the bank, since deriving it is an issuer function. The derivation is
// byte for byte the PSP's and it reuses the same provisioned key from the shared vault: changing either
// would silently invalidate every seeded card's CVV.
//
// The key is never at rest. A random data key is wrapped by the local master key and only the wrapped form
// is persisted; the verification key is derived from its cleartext by HKDF.
import { Binary, MongoClient } from 'mongodb';
import {
  createHmac, hkdfSync, createDecipheriv, createCipheriv, randomBytes,
} from 'node:crypto';
import { config } from '../../config';

const CVK_KEY_ALT_NAME = 'card-issuer-cvk';
const CVK_PURPOSE = 'card-issuer-cvk';
const CVK_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

interface CvkRecord {
  keyAltNames: string[];
  cvkKeyId: string;
  cvkWrapped: Binary;
  kid: string;
}

function keyVaultParts(): { database: string; collection: string } {
  const [database, ...rest] = config.kms.keyVaultNamespace.split('.');
  return { database, collection: rest.join('.') };
}

// Derived identically to the PSP's, which is what lets the bank unwrap a key the PSP provisioned.
function keyEncryptingKey(): Buffer {
  const masterKeyBase64 = config.kms.localMasterKey;
  if (!masterKeyBase64) throw new Error('a local master key is required to resolve the card verification key');
  const master = Buffer.from(masterKeyBase64, 'base64');
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from('chd-kek'), 32));
}

function unwrapDataKey(wrapped: Buffer): Buffer {
  const kek = keyEncryptingKey();
  const iv = wrapped.subarray(0, GCM_IV_BYTES);
  const tag = wrapped.subarray(wrapped.length - GCM_TAG_BYTES);
  const ciphertext = wrapped.subarray(GCM_IV_BYTES, wrapped.length - GCM_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function wrapDataKey(dataKey: Buffer): Buffer {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyEncryptingKey(), iv);
  const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return Buffer.concat([iv, wrapped, cipher.getAuthTag()]);
}

/**
 * Mints the key once and reuses it forever after. Idempotent, and it reuses a key an earlier version
 * provisioned: minting a fresh one would change every card's verification value.
 */
export async function provisionCardIssuerCvk(client: MongoClient): Promise<string> {
  const { database, collection } = keyVaultParts();
  const keyVault = client.db(database).collection<CvkRecord>(collection);
  const existing = await keyVault.findOne({ keyAltNames: CVK_KEY_ALT_NAME });
  if (existing) {
    console.log(`    reuse: ${CVK_KEY_ALT_NAME}`);
    return existing.cvkKeyId;
  }
  if (config.kms.provider !== 'local') {
    throw new Error(`the card verification key can only be provisioned under the local key provider, not '${config.kms.provider}'`);
  }
  const dataKey = randomBytes(32);
  const cvkKeyId = `cvk-${CVK_KEY_ALT_NAME}`;
  await keyVault.insertOne({
    keyAltNames: [CVK_KEY_ALT_NAME],
    cvkKeyId,
    cvkWrapped: new Binary(wrapDataKey(dataKey)),
    kid: 'local',
  } as CvkRecord);
  dataKey.fill(0);
  console.log(`    new:   ${CVK_KEY_ALT_NAME}`);
  return cvkKeyId;
}

let cvkCache: Buffer | null = null;

/**
 * Resolves the cleartext key, cached for the process lifetime. Refused rather than defaulted when it was
 * never provisioned: a fallback key would check every CVV against the wrong value.
 */
export async function getCardIssuerCvk(client: MongoClient): Promise<Buffer> {
  if (cvkCache) return cvkCache;
  if (config.kms.provider !== 'local') {
    throw new Error(`the card verification key is only resolvable under the local key provider, not '${config.kms.provider}'`);
  }
  const { database, collection } = keyVaultParts();
  const record = await client.db(database).collection<CvkRecord>(collection)
    .findOne({ keyAltNames: CVK_KEY_ALT_NAME });
  if (!record) throw new Error('the card verification key is not provisioned (run setup)');

  // A Binary can carry more capacity than payload, and the extra bytes break tag verification.
  const stored = record.cvkWrapped as unknown as { buffer: Uint8Array; length?: () => number };
  const wrapped = typeof stored?.length === 'function'
    ? Buffer.from(stored.buffer.subarray(0, stored.length()))
    : Buffer.from(stored?.buffer ?? (record.cvkWrapped as unknown as Uint8Array));

  const dataKey = unwrapDataKey(wrapped);
  const cvk = Buffer.from(hkdfSync('sha256', dataKey, Buffer.alloc(0), Buffer.from(CVK_PURPOSE), CVK_BYTES));
  dataKey.fill(0);
  cvkCache = cvk;
  return cvk;
}

/** Clears the cached key: tests, and rotation. */
export function resetCvkCache(): void {
  if (cvkCache) cvkCache.fill(0);
  cvkCache = null;
}

/** Normalises an expiry to MMYY, so MM/YY and MM/YYYY derive the same value. */
export function normalizeExpiry(expiry: string): string {
  const match = (expiry ?? '').trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!match) return (expiry ?? '').replace(/\D/g, '').slice(0, 4);
  const month = match[1].padStart(2, '0');
  const year = match[2].length === 4 ? match[2].slice(2) : match[2];
  return `${month}${year}`;
}

/** The per-card verification value. Every input is non-sensitive; the secret is the key. */
export function derivePerCardCvv(
  cvk: Buffer,
  args: { cardToken: string; expiryMMYY: string; serviceCode: string; cvvLength: number },
): string {
  const message = `${args.cardToken}|${normalizeExpiry(args.expiryMMYY)}|${args.serviceCode}`;
  const mac = createHmac('sha256', cvk).update(message, 'utf8').digest();
  let digits = '';
  for (let index = 0; index < mac.length && digits.length < args.cvvLength; index += 1) {
    digits += (mac[index] % 10).toString();
  }
  while (digits.length < args.cvvLength) digits += '0';
  return digits.slice(0, args.cvvLength);
}

// Used when a card carries none: international interchange, normal authorisation, no restrictions.
export const DEFAULT_SERVICE_CODE = '201';

// The issuer's Card Verification Key, and the per-card CVV derived from it.
//
// PCI DSS: a CVV is Sensitive Authentication Data and is NEVER stored, in cleartext or encrypted. A real
// issuer recomputes it inside an HSM from the card data plus a secret issuer key. That is reproduced here:
// the value is derived on demand as HMAC-SHA256(CVK, cardToken | expiryMMYY | serviceCode) and never
// persisted.
//
// v37 P7: this moved from the PSP to the bank, because deriving a card verification value is an ISSUER
// function and the issuer is now a separate institution. The derivation is byte for byte the one the PSP
// used, and it reuses the SAME provisioned key from the shared key vault, so every card that had a working
// CVV before still has the same one. Changing either would silently invalidate every seeded card.
//
// The CVK itself is never at rest: a random data key is wrapped by the local KMS master key and stored
// wrapped, and the CVK is derived from that key's cleartext by HKDF. Only the wrapped form is persisted.
import { Binary, MongoClient } from 'mongodb';
import {
  createHmac, hkdfSync, createDecipheriv,
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

// The key-encrypting key, derived from the same local master key Queryable Encryption uses. Identical
// derivation to the PSP's, which is what lets the bank unwrap a key the PSP provisioned.
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

let cvkCache: Buffer | null = null;

/**
 * Resolves the cleartext CVK. Cached for the process lifetime, and refused rather than defaulted when the
 * key has never been provisioned: a fallback key would make every CVV check pass against the wrong value.
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

  // A BSON Binary can carry more capacity than payload; slicing to the actual length is what keeps the
  // authentication tag verifiable.
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

/** Clears the cached key. Used by tests, and after a rotation. */
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

/**
 * The per-card verification value. Every input is non-sensitive (a surrogate token, an expiry, a service
 * code); the secret is the key, and the output is ephemeral.
 */
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

// The service code used when a card carries none. Three digits: international interchange, normal
// authorisation, no restrictions.
export const DEFAULT_SERVICE_CODE = '201';

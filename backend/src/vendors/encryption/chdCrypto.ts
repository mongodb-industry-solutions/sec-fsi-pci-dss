// CHD envelope encryption (architecture §7.8). The `chd` field is the only carrier of cardholder
// data on the bus and is ALWAYS an opaque ciphertext token. Envelope encryption: a per-message DEK
// encrypts the content; the DEK is wrapped by a CMK that never leaves the KMS. node:crypto only.
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';

// Cleartext CHD shape — the minimal fields the issuer needs (§7.8). On the tokenized payment path the
// PAN/expiry are not present (the card was tokenized client-side); only the CVV is carried, still as
// the opaque `chd` token. cvv is the always-present verification value; cardNumber/expiry are optional.
export interface ChdCleartext {
  cardNumber?: string;
  cvv: string;
  expiry?: string;                          // MM/YY
}

// Journey binding for the AAD — a token cannot be replayed onto another event/journey (§7.8).
export interface ChdContext {
  correlationId: string;
  eventType: string;
}

// The crypto contract used by the producer (psp.core) and the Card Issuer adapter.
export interface ChdCrypto {
  /** Encrypt CHD to the opaque `chd` token, bound to the journey via AAD. */
  encrypt(cleartext: ChdCleartext, ctx: ChdContext): Promise<string>;
  /** Decrypt a `chd` token; throws if the AAD/journey or auth tag does not match. */
  decrypt(token: string, ctx: ChdContext): Promise<ChdCleartext>;
}

// KMS abstraction — local now (default), AWS/Azure/GCP/KMIP wired here later without touching ChdCrypto.
export interface KmsDataKey { dek: Buffer; wrappedDEK: Buffer; kid: string }
export interface KmsKeyProvider {
  /** Mint a fresh 256-bit DEK and its CMK-wrapped form (KMS.GenerateDataKey). */
  generateDataKey(): Promise<KmsDataKey>;
  /** Unwrap a previously wrapped DEK (KMS.Decrypt); restricted to the issuer adapter's grant. */
  unwrapDataKey(wrappedDEK: Buffer, kid: string): Promise<Buffer>;
}

const TOKEN_VERSION = 'v1';
const GCM_IV_BYTES = 12;
const DEK_BYTES = 32;
const b64url = (b: Buffer) => b.toString('base64url');
const fromB64url = (s: string) => Buffer.from(s, 'base64url');
const aad = (ctx: ChdContext) => Buffer.from(`${ctx.correlationId}.${ctx.eventType}`, 'utf8');

function zeroize(...bufs: Buffer[]): void {
  for (const b of bufs) b.fill(0);
}

// ── Local KMS provider ────────────────────────────────────────────────────────
// CMK = the KMS_LOCAL_MASTER_KEY (same key-management surface as Queryable Encryption). A 256-bit
// key-encryption key (KEK) is derived from it via HKDF-SHA256; DEKs are wrapped with AES-256-GCM.
export class LocalKmsKeyProvider implements KmsKeyProvider {
  private readonly kek: Buffer;
  readonly kid = 'local';

  constructor(masterKeyBase64 = process.env.KMS_LOCAL_MASTER_KEY) {
    if (!masterKeyBase64) throw new Error('KMS_LOCAL_MASTER_KEY is required for local CHD crypto');
    const master = Buffer.from(masterKeyBase64, 'base64');
    // Derive a stable 256-bit KEK (the QE local key is 96 bytes; we need 32 for AES-256).
    this.kek = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from('chd-kek'), 32));
  }

  async generateDataKey(): Promise<KmsDataKey> {
    const dek = randomBytes(DEK_BYTES);
    const iv = randomBytes(GCM_IV_BYTES);
    const c = createCipheriv('aes-256-gcm', this.kek, iv);
    const wrapped = Buffer.concat([c.update(dek), c.final()]);
    const tag = c.getAuthTag();
    // wrappedDEK blob = iv || wrappedCiphertext || tag
    return { dek, wrappedDEK: Buffer.concat([iv, wrapped, tag]), kid: this.kid };
  }

  async unwrapDataKey(wrappedDEK: Buffer, _kid: string): Promise<Buffer> {
    const iv = wrappedDEK.subarray(0, GCM_IV_BYTES);
    const tag = wrappedDEK.subarray(wrappedDEK.length - 16);
    const ct = wrappedDEK.subarray(GCM_IV_BYTES, wrappedDEK.length - 16);
    const d = createDecipheriv('aes-256-gcm', this.kek, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  }
}

// ── Envelope crypto (AES-256-GCM content + KMS-wrapped DEK) ────────────────────
export class EnvelopeChdCrypto implements ChdCrypto {
  constructor(private readonly kms: KmsKeyProvider) {}

  async encrypt(cleartext: ChdCleartext, ctx: ChdContext): Promise<string> {
    const { dek, wrappedDEK, kid } = await this.kms.generateDataKey();
    const plaintext = Buffer.from(JSON.stringify(cleartext), 'utf8');
    try {
      const iv = randomBytes(GCM_IV_BYTES);
      const c = createCipheriv('aes-256-gcm', dek, iv).setAAD(aad(ctx));
      const ciphertext = Buffer.concat([c.update(plaintext), c.final()]);
      const tag = c.getAuthTag();
      return [TOKEN_VERSION, b64url(Buffer.from(kid, 'utf8')), b64url(wrappedDEK),
        b64url(iv), b64url(ciphertext), b64url(tag)].join('.');
    } finally {
      zeroize(dek, plaintext);
    }
  }

  async decrypt(token: string, ctx: ChdContext): Promise<ChdCleartext> {
    const parts = token.split('.');
    if (parts.length !== 6 || parts[0] !== TOKEN_VERSION) throw new Error('invalid chd token');
    const kid = fromB64url(parts[1]).toString('utf8');
    const wrappedDEK = fromB64url(parts[2]);
    const iv = fromB64url(parts[3]);
    const ciphertext = fromB64url(parts[4]);
    const tag = fromB64url(parts[5]);
    const dek = await this.kms.unwrapDataKey(wrappedDEK, kid);
    let plaintext: Buffer | undefined;
    try {
      const d = createDecipheriv('aes-256-gcm', dek, iv).setAAD(aad(ctx)).setAuthTag(tag);
      plaintext = Buffer.concat([d.update(ciphertext), d.final()]); // throws on tag/AAD mismatch
      return JSON.parse(plaintext.toString('utf8')) as ChdCleartext;
    } finally {
      zeroize(dek, ...(plaintext ? [plaintext] : []));
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────
// Selects the KMS provider by the same KMS_PROVIDER switch used by Queryable Encryption.
// Local is fully implemented (demo default). External KMS providers plug in here.
export function buildKmsKeyProvider(): KmsKeyProvider {
  const provider = process.env.KMS_PROVIDER ?? 'local';
  if (provider === 'local') return new LocalKmsKeyProvider();
  // Door left open: an AWS/Azure/GCP/KMIP KmsKeyProvider implements GenerateDataKey/Decrypt here,
  // reusing the same CMK as Queryable Encryption (§7.8). Not enabled in the demo environment.
  throw new Error(`CHD crypto KMS provider '${provider}' is not wired yet; set KMS_PROVIDER=local`);
}

let instance: ChdCrypto | null = null;
export function getChdCrypto(): ChdCrypto {
  if (!instance) instance = new EnvelopeChdCrypto(buildKmsKeyProvider());
  return instance;
}
export function setChdCrypto(crypto: ChdCrypto): void { instance = crypto; }

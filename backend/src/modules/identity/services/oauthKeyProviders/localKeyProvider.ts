import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { OAuthKeyProvider, OAuthPublicKeyEntry } from './index';

/**
 * Filesystem-backed OAuth signing key provider (ADR-036).
 *
 * Layout of the key store directory (PSP_OAUTH_KEY_STORE_DIR, default backend/keys/):
 *   private.pem              active private key (pkcs8, chmod 600) — signs tokens
 *   public.pem               active public key  (spki,  chmod 644)
 *   retired/<kid>.pub.pem    deprecated public keys — verify-only during the grace period
 *
 * The private key material for deprecated keys is intentionally discarded on rotation:
 * only the active key signs, deprecated keys are kept solely to verify tokens issued
 * before the rotation (and to appear in the JWKS) until they are revoked.
 */
export class LocalKeyProvider implements OAuthKeyProvider {
  private storeDir: string;
  private privateKeyPath: string;
  private publicKeyPath: string;
  private retiredDir: string;

  private privateKey!: crypto.KeyObject;
  private activeKid!: string;
  private activePublicPem!: string;

  constructor(storeDir: string) {
    this.storeDir = path.resolve(storeDir);
    this.privateKeyPath = path.join(this.storeDir, 'private.pem');
    this.publicKeyPath = path.join(this.storeDir, 'public.pem');
    this.retiredDir = path.join(this.storeDir, 'retired');
    this.loadActive();
  }

  // ── Signing / active key ──────────────────────────────────────────────────

  async sign(data: Buffer): Promise<Buffer> {
    return crypto.createSign('SHA256').update(data).sign(this.privateKey);
  }

  getKid(): string {
    return this.activeKid;
  }

  async getPublicKeyJwk(): Promise<JsonWebKey> {
    const pub = crypto.createPublicKey(this.privateKey);
    return pub.export({ format: 'jwk' }) as JsonWebKey;
  }

  getPublicKeyPem(): string {
    return this.activePublicPem;
  }

  // ── Key set (active + deprecated) ───────────────────────────────────────────

  async listPublicKeys(): Promise<OAuthPublicKeyEntry[]> {
    const entries: OAuthPublicKeyEntry[] = [
      { kid: this.activeKid, publicKeyPem: this.activePublicPem, status: 'active' },
    ];
    for (const [kid, pem] of this.readRetired()) {
      entries.push({ kid, publicKeyPem: pem, status: 'deprecated' });
    }
    return entries;
  }

  async getPublicPemByKid(kid: string): Promise<string | null> {
    if (kid === this.activeKid) return this.activePublicPem;
    return this.readRetired().get(kid) ?? null;
  }

  supportsRotation(): boolean {
    return true;
  }

  // ── Management operations ────────────────────────────────────────────────────

  async rotate(): Promise<{ kid: string; publicKeyPem: string }> {
    this.retireActive();
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    this.writeActive(privateKey as string, publicKey as string);
    this.loadActive();
    return { kid: this.activeKid, publicKeyPem: this.activePublicPem };
  }

  async importKeypair(privateKeyPem: string, publicKeyPem: string): Promise<{ kid: string; publicKeyPem: string }> {
    // Validate the pair matches by deriving the public key from the private key.
    const priv = crypto.createPrivateKey(privateKeyPem);
    const derivedPub = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' }) as string;
    const suppliedPub = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'pem' }) as string;
    if (derivedPub.trim() !== suppliedPub.trim()) {
      throw Object.assign(new Error('Public key does not match the provided private key'), { statusCode: 400 });
    }
    this.retireActive();
    this.writeActive(privateKeyPem, derivedPub);
    this.loadActive();
    return { kid: this.activeKid, publicKeyPem: this.activePublicPem };
  }

  async revoke(kid: string): Promise<void> {
    if (kid === this.activeKid) {
      throw Object.assign(new Error('Cannot revoke the active signing key — rotate first'), { statusCode: 400 });
    }
    const file = path.join(this.retiredDir, `${kid}.pub.pem`);
    if (!fs.existsSync(file)) {
      throw Object.assign(new Error(`Key ${kid} not found`), { statusCode: 404 });
    }
    fs.rmSync(file);
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private loadActive(): void {
    if (!fs.existsSync(this.privateKeyPath)) {
      if (process.env.NODE_ENV === 'development') {
        this.generateAndPersist();
      } else {
        throw new Error(
          `OAuth private key not found at ${this.privateKeyPath}.\n` +
          '  Run: npm run setup:key:rsa\n' +
          '  Or set OAUTH_KEY_PROVIDER=aws for KMS-backed signing.'
        );
      }
    }
    const pem = fs.readFileSync(this.privateKeyPath, 'utf8');
    this.privateKey = crypto.createPrivateKey(pem);
    const pubObj = crypto.createPublicKey(this.privateKey);
    this.activePublicPem = pubObj.export({ type: 'spki', format: 'pem' }) as string;
    this.activeKid = this.deriveKid(pubObj);
    // Ensure public.pem on disk stays in sync with the private key.
    if (!fs.existsSync(this.publicKeyPath)) {
      fs.writeFileSync(this.publicKeyPath, this.activePublicPem, { mode: 0o644 });
    }
  }

  /** Move the current active public key into the retired/ grace store. Private material is dropped. */
  private retireActive(): void {
    if (!this.activeKid || !this.activePublicPem) return;
    fs.mkdirSync(this.retiredDir, { recursive: true });
    fs.writeFileSync(path.join(this.retiredDir, `${this.activeKid}.pub.pem`), this.activePublicPem, { mode: 0o644 });
  }

  private writeActive(privateKeyPem: string, publicKeyPem: string): void {
    fs.mkdirSync(this.storeDir, { recursive: true });
    fs.writeFileSync(this.privateKeyPath, privateKeyPem, { mode: 0o600 });
    fs.writeFileSync(this.publicKeyPath, publicKeyPem, { mode: 0o644 });
  }

  private readRetired(): Map<string, string> {
    const map = new Map<string, string>();
    if (!fs.existsSync(this.retiredDir)) return map;
    for (const f of fs.readdirSync(this.retiredDir)) {
      if (!f.endsWith('.pub.pem')) continue;
      const kid = f.slice(0, -'.pub.pem'.length);
      if (kid === this.activeKid) continue; // active key is never also "deprecated"
      map.set(kid, fs.readFileSync(path.join(this.retiredDir, f), 'utf8'));
    }
    return map;
  }

  private generateAndPersist(): void {
    fs.mkdirSync(this.storeDir, { recursive: true });
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(this.privateKeyPath, privateKey as string, { mode: 0o600 });
    fs.writeFileSync(this.publicKeyPath, publicKey as string, { mode: 0o644 });
    console.log(`[oauth-keys] Generated new RSA-2048 keypair at ${this.privateKeyPath} (+ public.pem)`);
  }

  private deriveKid(pub: crypto.KeyObject): string {
    const der = pub.export({ type: 'spki', format: 'der' }) as Buffer;
    return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
  }
}

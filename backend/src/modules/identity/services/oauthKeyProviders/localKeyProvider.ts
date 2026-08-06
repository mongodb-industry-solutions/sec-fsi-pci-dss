import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { OAuthKeyProvider, OAuthPublicKeyEntry } from './index';

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Filesystem-backed OAuth signing key provider (ADR-036).
 *
 * Layout of the key store directory (PSP_OAUTH_KEY_STORE_DIR, default backend/keys/):
 *   private.pem              active private key (pkcs8, chmod 600): signs tokens
 *   public.pem               active public key  (spki,  chmod 644)
 *   retired/<kid>.pub.pem    deprecated public keys: verify-only during the grace period
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

  private constructor(storeDir: string) {
    this.storeDir = path.resolve(storeDir);
    this.privateKeyPath = path.join(this.storeDir, 'private.pem');
    this.publicKeyPath = path.join(this.storeDir, 'public.pem');
    this.retiredDir = path.join(this.storeDir, 'retired');
  }

  /** Async factory: a constructor can't await, so key loading (fs I/O) happens here before the instance is handed out. */
  static async create(storeDir: string): Promise<LocalKeyProvider> {
    const provider = new LocalKeyProvider(storeDir);
    await provider.loadActive();
    return provider;
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
    for (const [kid, pem] of await this.readRetired()) {
      entries.push({ kid, publicKeyPem: pem, status: 'deprecated' });
    }
    return entries;
  }

  async getPublicPemByKid(kid: string): Promise<string | null> {
    if (kid === this.activeKid) return this.activePublicPem;
    return (await this.readRetired()).get(kid) ?? null;
  }

  supportsRotation(): boolean {
    return true;
  }

  // ── Management operations ────────────────────────────────────────────────────

  async rotate(): Promise<{ kid: string; publicKeyPem: string }> {
    await this.retireActive();
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    await this.writeActive(privateKey as string, publicKey as string);
    await this.loadActive();
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
    await this.retireActive();
    await this.writeActive(privateKeyPem, derivedPub);
    await this.loadActive();
    return { kid: this.activeKid, publicKeyPem: this.activePublicPem };
  }

  async revoke(kid: string): Promise<void> {
    if (kid === this.activeKid) {
      throw Object.assign(new Error('Cannot revoke the active signing key: rotate first'), { statusCode: 400 });
    }
    const file = path.join(this.retiredDir, `${kid}.pub.pem`);
    if (!(await pathExists(file))) {
      throw Object.assign(new Error(`Key ${kid} not found`), { statusCode: 404 });
    }
    await fs.rm(file);
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async loadActive(): Promise<void> {
    if (!(await pathExists(this.privateKeyPath))) {
      // Auto-generate a signing key when missing in any NON-production environment (development,
      // staging, demos) so the local provider works without mounting a key file or standing up KMS.
      // PRODUCTION still fails closed by default: a real, persisted key (or KMS) must be provisioned
      // there: an auto-generated ephemeral key would not survive restarts and would diverge across
      // replicas. Set PSP_OAUTH_KEY_AUTO_GENERATE=true to explicitly opt into ephemeral generation in
      // production anyway (e.g. single-replica deployments without KMS available yet).
      if (process.env.NODE_ENV !== 'production' || process.env.PSP_OAUTH_KEY_AUTO_GENERATE === 'true') {
        await this.generateAndPersist();
      } else {
        throw new Error(
          `OAuth private key not found at ${this.privateKeyPath}.\n` +
          '  Run: npm run setup:key:rsa (and mount/persist backend/keys)\n' +
          '  Or set PSP_OAUTH_KEY_AUTO_GENERATE=true to auto-generate anyway.\n' +
          '  Or set PSP_OAUTH_KEY_PROVIDER=aws for KMS-backed signing.'
        );
      }
    }
    const pem = await fs.readFile(this.privateKeyPath, 'utf8');
    this.privateKey = crypto.createPrivateKey(pem);
    const pubObj = crypto.createPublicKey(this.privateKey);
    this.activePublicPem = pubObj.export({ type: 'spki', format: 'pem' }) as string;
    this.activeKid = this.deriveKid(pubObj);
    // Ensure public.pem on disk stays in sync with the private key.
    if (!(await pathExists(this.publicKeyPath))) {
      await fs.writeFile(this.publicKeyPath, this.activePublicPem, { mode: 0o644 });
    }
  }

  /** Move the current active public key into the retired/ grace store. Private material is dropped. */
  private async retireActive(): Promise<void> {
    if (!this.activeKid || !this.activePublicPem) return;
    await fs.mkdir(this.retiredDir, { recursive: true });
    await fs.writeFile(path.join(this.retiredDir, `${this.activeKid}.pub.pem`), this.activePublicPem, { mode: 0o644 });
  }

  private async writeActive(privateKeyPem: string, publicKeyPem: string): Promise<void> {
    await fs.mkdir(this.storeDir, { recursive: true });
    await fs.writeFile(this.privateKeyPath, privateKeyPem, { mode: 0o600 });
    await fs.writeFile(this.publicKeyPath, publicKeyPem, { mode: 0o644 });
  }

  private async readRetired(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!(await pathExists(this.retiredDir))) return map;
    for (const f of await fs.readdir(this.retiredDir)) {
      if (!f.endsWith('.pub.pem')) continue;
      const kid = f.slice(0, -'.pub.pem'.length);
      if (kid === this.activeKid) continue; // active key is never also "deprecated"
      map.set(kid, await fs.readFile(path.join(this.retiredDir, f), 'utf8'));
    }
    return map;
  }

  private async generateAndPersist(): Promise<void> {
    // Defensive: loadActive() already gates this call on the key being absent, but guard here too so
    // a direct/future call never clobbers an existing active key.
    if (await pathExists(this.privateKeyPath)) return;
    await fs.mkdir(this.storeDir, { recursive: true });
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    await fs.writeFile(this.privateKeyPath, privateKey as string, { mode: 0o600 });
    await fs.writeFile(this.publicKeyPath, publicKey as string, { mode: 0o644 });
    console.log(`[oauth-keys] Generated new RSA-2048 keypair at ${this.privateKeyPath} (+ public.pem)`);
  }

  private deriveKid(pub: crypto.KeyObject): string {
    const der = pub.export({ type: 'spki', format: 'der' }) as Buffer;
    return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
  }
}

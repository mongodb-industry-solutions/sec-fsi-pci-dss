import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { OAuthKeyProvider } from './index';

export class LocalKeyProvider implements OAuthKeyProvider {
  private privateKey: crypto.KeyObject;
  private kid: string;

  constructor(storeDir: string) {
    const privateKeyPath = path.resolve(storeDir, 'private.pem');

    if (!fs.existsSync(privateKeyPath)) {
      if (process.env.NODE_ENV === 'development') {
        this.privateKey = this.generateAndPersist(storeDir, privateKeyPath);
      } else {
        throw new Error(
          `OAuth private key not found at ${privateKeyPath}.\n` +
          '  Run: npm run setup:keys\n' +
          '  Or set OAUTH_KEY_PROVIDER=aws for KMS-backed signing.'
        );
      }
    } else {
      const pem = fs.readFileSync(privateKeyPath, 'utf8');
      this.privateKey = crypto.createPrivateKey(pem);
    }

    this.kid = this.deriveKid();
  }

  async sign(data: Buffer): Promise<Buffer> {
    const sig = crypto.createSign('SHA256').update(data).sign(this.privateKey);
    return sig;
  }

  async getPublicKeyJwk(): Promise<JsonWebKey> {
    const pub = crypto.createPublicKey(this.privateKey);
    return pub.export({ format: 'jwk' }) as JsonWebKey;
  }

  getKid(): string {
    return this.kid;
  }

  getPublicKeyPem(): string {
    return crypto.createPublicKey(this.privateKey).export({ type: 'spki', format: 'pem' }) as string;
  }

  private generateAndPersist(storeDir: string, privateKeyPath: string): crypto.KeyObject {
    fs.mkdirSync(storeDir, { recursive: true });
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(privateKeyPath, privateKey as string, { mode: 0o600 });
    console.log(`[oauth-keys] Generated new RSA-2048 keypair at ${privateKeyPath}`);
    return crypto.createPrivateKey(privateKey as string);
  }

  private deriveKid(): string {
    const pub = crypto.createPublicKey(this.privateKey);
    const der = pub.export({ type: 'spki', format: 'der' }) as Buffer;
    return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
  }
}

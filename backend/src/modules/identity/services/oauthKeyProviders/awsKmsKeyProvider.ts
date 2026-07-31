import * as crypto from 'crypto';
import { OAuthKeyProvider, OAuthPublicKeyEntry } from './index';

// Lazy-import AWS SDK so the server starts without AWS credentials when OAUTH_KEY_PROVIDER=local
// @ts-ignore — @aws-sdk/client-kms is an optional peer dependency (only required when OAUTH_KEY_PROVIDER=aws)
let KMSClient: any;
// @ts-ignore
let SignCommand: any;
// @ts-ignore
let GetPublicKeyCommand: any;

async function loadKms() {
  if (!KMSClient) {
    // @ts-ignore
    const mod = await import('@aws-sdk/client-kms');
    KMSClient = mod.KMSClient;
    SignCommand = mod.SignCommand;
    GetPublicKeyCommand = mod.GetPublicKeyCommand;
  }
}

export class AwsKmsKeyProvider implements OAuthKeyProvider {
  private keyArn: string;
  private region: string;
  private kid: string | null = null;
  private cachedJwk: JsonWebKey | null = null;

  constructor(keyArn: string, region: string) {
    this.keyArn = keyArn;
    this.region = region;
  }

  async sign(data: Buffer): Promise<Buffer> {
    await loadKms();
    const client = new KMSClient({ region: this.region });
    const result = await client.send(new SignCommand({
      KeyId: this.keyArn,
      Message: data,
      MessageType: 'RAW',
      SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
    }));
    if (!result.Signature) throw new Error('KMS sign returned no signature');
    return Buffer.from(result.Signature);
  }

  async getPublicKeyJwk(): Promise<JsonWebKey> {
    if (this.cachedJwk) return this.cachedJwk;
    await loadKms();
    const client = new KMSClient({ region: this.region });
    const result = await client.send(new GetPublicKeyCommand({ KeyId: this.keyArn }));
    if (!result.PublicKey) throw new Error('KMS getPublicKey returned no key');
    const der = Buffer.from(result.PublicKey);
    const keyObj = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    this.cachedJwk = keyObj.export({ format: 'jwk' }) as JsonWebKey;
    this.kid = this.deriveKid(der);
    return this.cachedJwk;
  }

  getKid(): string {
    if (!this.kid) throw new Error('Call getPublicKeyJwk() before getKid() on AwsKmsKeyProvider');
    return this.kid;
  }

  private async getPublicKeyPemInternal(): Promise<string> {
    await this.getPublicKeyJwk(); // ensures kid + jwk cached
    const pubKey = crypto.createPublicKey({ key: this.cachedJwk as JsonWebKey, format: 'jwk' });
    return pubKey.export({ type: 'spki', format: 'pem' }) as string;
  }

  async listPublicKeys(): Promise<OAuthPublicKeyEntry[]> {
    const publicKeyPem = await this.getPublicKeyPemInternal();
    return [{ kid: this.getKid(), publicKeyPem, status: 'active' }];
  }

  async getPublicPemByKid(kid: string): Promise<string | null> {
    const publicKeyPem = await this.getPublicKeyPemInternal();
    return kid === this.getKid() ? publicKeyPem : null;
  }

  supportsRotation(): boolean {
    return false;
  }

  async rotate(): Promise<{ kid: string; publicKeyPem: string }> {
    throw Object.assign(
      new Error('Rotation is managed inside AWS KMS — create a new CMK / KMS key rotation, not via this API'),
      { statusCode: 400 },
    );
  }

  async importKeypair(): Promise<{ kid: string; publicKeyPem: string }> {
    throw Object.assign(
      new Error('Key import is not supported with the AWS KMS provider — the private key never leaves KMS'),
      { statusCode: 400 },
    );
  }

  async revoke(): Promise<void> {
    throw Object.assign(
      new Error('Key revocation is managed inside AWS KMS — disable/schedule deletion of the CMK there'),
      { statusCode: 400 },
    );
  }

  private deriveKid(der: Buffer): string {
    return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
  }
}

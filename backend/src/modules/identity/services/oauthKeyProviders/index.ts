import { LocalKeyProvider } from './localKeyProvider';
import { AwsKmsKeyProvider } from './awsKmsKeyProvider';
import { config } from '../../../../config';

export type OAuthKeyStatus = 'active' | 'deprecated';

export interface OAuthPublicKeyEntry {
  kid: string;
  publicKeyPem: string;
  status: OAuthKeyStatus; // 'active' = current signing key; 'deprecated' = grace-period verify-only
}

/**
 * ADR-036: the keypair material is owned by the provider (local filesystem or AWS KMS),
 * which is the single source of truth. The partyAuthenticationKey collection is audit
 * metadata only — it is NOT read to verify tokens or build the JWKS.
 */
export interface OAuthKeyProvider {
  /** Sign with the active private key. */
  sign(data: Buffer): Promise<Buffer>;
  /** kid of the active signing key. */
  getKid(): string;
  /** JWK of the active public key (kept for backward compatibility). */
  getPublicKeyJwk(): Promise<JsonWebKey>;
  /** All non-revoked public keys (active + deprecated) for the JWKS endpoint. */
  listPublicKeys(): Promise<OAuthPublicKeyEntry[]>;
  /** Public key PEM for a given kid, or null if unknown/revoked. Used for verification and /public.pem. */
  getPublicPemByKid(kid: string): Promise<string | null>;
  /** Whether this provider can rotate/import/revoke keys in-process (local: yes, KMS: no). */
  supportsRotation(): boolean;
  /** Generate a new active keypair; the previous active key becomes deprecated (grace period). */
  rotate(): Promise<{ kid: string; publicKeyPem: string }>;
  /** Import an externally generated PEM keypair as the new active key; previous becomes deprecated. */
  importKeypair(privateKeyPem: string, publicKeyPem: string): Promise<{ kid: string; publicKeyPem: string }>;
  /** Permanently remove a deprecated key's material. The active key cannot be revoked. */
  revoke(kid: string): Promise<void>;
}

export async function createOAuthKeyProvider(): Promise<OAuthKeyProvider> {
  const provider = config.oauth.keyProvider;
  if (provider === 'aws') {
    const keyArn = config.oauth.awsKeyArn;
    if (!keyArn) {
      throw new Error('PSP_OAUTH_AWS_KEY_ARN is required when PSP_OAUTH_KEY_PROVIDER=aws');
    }
    return new AwsKmsKeyProvider(keyArn, config.oauth.awsRegion);
  }
  const storeDir = config.oauth.keyStoreDir;
  return LocalKeyProvider.create(storeDir);
}

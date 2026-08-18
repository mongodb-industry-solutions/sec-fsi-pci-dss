import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../../../config';

// The key the bank signs its notifications with, and the public half it publishes.
//
// Asymmetric on purpose, even though a shared secret would be less work: the receiving side has to verify
// a JWS through a published key set, because that is what it will do against a real bank. Making the bank
// simple is allowed; making the CLIENT's verification unrealistic is not.
//
// The key is persisted next to the PSP's own key material rather than regenerated per process, so a
// restart does not invalidate a token already in flight and two replicas agree on what they signed.
const KEY_DIRECTORY = resolve(__dirname, '../../../../keys');
const PRIVATE_KEY_FILE = 'bankcore-set-signing.pem';

let cached: { privateKey: KeyObject; publicKey: KeyObject; keyId: string } | null = null;

// The key id is derived from the public key itself, so it changes when the key does and a receiver can
// cache by it. A random id would not survive a restart, and a fixed one would lie after a rotation.
function deriveKeyId(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('base64url').slice(0, 16);
}

function loadOrCreate(): { privateKey: KeyObject; publicKey: KeyObject; keyId: string } {
  const path = resolve(KEY_DIRECTORY, PRIVATE_KEY_FILE);
  if (existsSync(path)) {
    const pem = readFileSync(path, 'utf8');
    const privateKey = createPrivateKey(pem);
    // The public half is derived from the private key rather than stored beside it, so the two can never
    // disagree about which key the bank is actually signing with.
    const publicKey = createPublicKey(privateKey);
    return { privateKey, publicKey, keyId: deriveKeyId(publicKey) };
  }

  // 2048 bits: what RS256 deployments use, and enough for a demo that still has to be verifiable.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  mkdirSync(KEY_DIRECTORY, { recursive: true });
  // 0o600 where the platform honours it: a signing key readable by anything on the box is not a key.
  writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { mode: 0o600 });
  console.log(`[bankcore/keys] generated the notification signing key at ${path}`);
  return { privateKey, publicKey, keyId: deriveKeyId(publicKey) };
}

export function signingKey(): { privateKey: KeyObject; keyId: string } {
  if (!cached) cached = loadOrCreate();
  return { privateKey: cached.privateKey, keyId: cached.keyId };
}

export interface JsonWebKey {
  kty: string;
  n: string;
  e: string;
  alg: string;
  use: string;
  kid: string;
}

/** The public key set, as a receiver fetches it. One key: there is nothing to rotate to yet. */
export function publicJwks(): { keys: JsonWebKey[] } {
  if (!cached) cached = loadOrCreate();
  const jwk = cached.publicKey.export({ format: 'jwk' }) as { n?: string; e?: string };
  return {
    keys: [{
      kty: 'RSA',
      n: jwk.n ?? '',
      e: jwk.e ?? '',
      alg: 'RS256',
      use: 'sig',
      kid: cached.keyId,
    }],
  };
}

/** The URL a receiver fetches the key set from, written into the subscription record at seed time. */
export function jwksUrl(): string {
  return `${config.server.baseUrl}/.well-known/jwks.json`;
}

/** For tests: forget the loaded key so a fresh one is read. Never called by the server. */
export function resetSigningKeyCache(): void {
  cached = null;
}

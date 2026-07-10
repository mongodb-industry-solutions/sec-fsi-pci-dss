/**
 * browser software authenticator for passwordless enrollment (PSP portal).
 *
 * Generates a real ECDSA P-256 (ES256) key pair with the PRIVATE key NON-EXTRACTABLE, and stores the
 * CryptoKey handle in IndexedDB (never localStorage, never a serialized string). The private key cannot
 * be exfiltrated even under XSS. Signing produces a WebCrypto raw r||s signature, which the backend
 * verifier accepts (it normalizes raw -> DER for ES256).
 *
 * This is a real software authenticator (NIST AAL1, user-presence). Platform biometric user-verification
 * (Face ID / Windows Hello) is a later AAL2 upgrade that does not change this contract.
 */

const DB_NAME = 'psp-passwordless';
const STORE = 'authenticators';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(key: string, value: CryptoKey): Promise<void> {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbGet(key: string): Promise<CryptoKey | undefined> {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => reject(req.error);
  }));
}

function idbDelete(key: string): Promise<void> {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function toB64(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function b64UrlFromBuffer(buf: ArrayBuffer): string {
  return toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function spkiToPem(spki: ArrayBuffer): string {
  const b64 = toB64(spki);
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`;
}

export interface GeneratedAuthenticator {
  credentialId: string;
  publicKeyPem: string;
  alg: 'ES256';
}

/**
 * Generate a new authenticator key pair, persist the non-extractable private key in IndexedDB under a
 * fresh credentialId, and return the credentialId + public key PEM to register with the server.
 */
export async function generateAuthenticator(): Promise<GeneratedAuthenticator> {
  const credentialId = crypto.randomUUID();
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, // privateKey non-extractable (publicKey remains exportable regardless)
    ['sign', 'verify'],
  );
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  await idbPut(credentialId, pair.privateKey);
  return { credentialId, publicKeyPem: spkiToPem(spki), alg: 'ES256' };
}

/**
 * Sign a server challenge string with the stored private key for `credentialId`.
 * Returns a base64url raw r||s signature (WebCrypto default) that the backend verifier accepts.
 */
export async function signChallenge(credentialId: string, challenge: string): Promise<string> {
  const key = await idbGet(credentialId);
  if (!key) throw new Error('No local key for this credential (enroll on this device first)');
  const data = new TextEncoder().encode(challenge);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return b64UrlFromBuffer(sig);
}

export async function forgetAuthenticator(credentialId: string): Promise<void> {
  await idbDelete(credentialId);
}

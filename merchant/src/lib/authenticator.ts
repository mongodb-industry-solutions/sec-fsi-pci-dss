/**
 * Browser software authenticator for the merchant's PASSWORDLESS LOGIN credential (v25).
 *
 * Generates a real ECDSA P-256 (ES256) key pair with the PRIVATE key NON-EXTRACTABLE and stores the
 * CryptoKey handle in IndexedDB (never localStorage, never a serialized string, never downloadable). The
 * private key cannot be exfiltrated even under XSS. Signing produces a WebCrypto raw r||s signature, which
 * the PSP verifier accepts (it normalizes raw -> DER for ES256).
 *
 * This is the login credential and is DISTINCT from the throwaway generator in `keygen.ts`: this key is
 * non-extractable and is never exported. Only the public key + minimal metadata leave the browser (to the
 * PSP at enrollment). NIST AAL1 (software authenticator + user presence); AAL2 when platform UV is enabled.
 */
'use client';

const DB_NAME = 'ew-merchant-passwordless';
const KEY_STORE = 'authenticators'; // credentialId -> non-extractable CryptoKey
const META_STORE = 'meta';          // 'current' -> CredentialMeta

export interface CredentialMeta {
  credentialId: string;
  alg: 'ES256';
  sub: string;
  email?: string;
  createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Each helper closes its connection once the transaction settles, so repeated operations don't accumulate
// open connections (notably on Safari, where leaked connections can block upgrades / fail transactions).
function idbPut(store: string, key: string, value: unknown): Promise<void> {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result as T | undefined); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

function idbDelete(store: string, key: string): Promise<void> {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
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

const META_KEY = 'current';

/** Is there an enrolled login credential (key + metadata) in this browser? */
export async function hasCredential(): Promise<boolean> {
  const meta = await idbGet<CredentialMeta>(META_STORE, META_KEY);
  if (!meta) return false;
  const key = await idbGet<CryptoKey>(KEY_STORE, meta.credentialId);
  return !!key;
}

export async function getMeta(): Promise<CredentialMeta | undefined> {
  return idbGet<CredentialMeta>(META_STORE, META_KEY);
}

export interface CreatedCredential {
  credentialId: string;
  publicKeyPem: string;
  alg: 'ES256';
}

/**
 * Generate a new login key pair (ES256), persist the NON-EXTRACTABLE private key in IndexedDB under a fresh
 * credentialId, and return the credentialId + public key PEM to register at the PSP. Metadata is written
 * separately by `saveMeta` only after the PSP confirms enrollment.
 */
export async function createCredential(): Promise<CreatedCredential> {
  const credentialId = crypto.randomUUID();
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, // privateKey non-extractable (publicKey stays exportable regardless)
    ['sign', 'verify'],
  );
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  await idbPut(KEY_STORE, credentialId, pair.privateKey);
  return { credentialId, publicKeyPem: spkiToPem(spki), alg: 'ES256' };
}

/** Persist the credential metadata after a successful PSP enrollment (builds the login_hint later). */
export async function saveMeta(meta: CredentialMeta): Promise<void> {
  await idbPut(META_STORE, META_KEY, meta);
}

/** Sign a challenge with a specific stored key. Used during enrollment (before metadata is persisted). */
export async function signWithCredential(credentialId: string, challenge: string): Promise<string> {
  const key = await idbGet<CryptoKey>(KEY_STORE, credentialId);
  if (!key) throw new Error('No local key for this credential');
  const data = new TextEncoder().encode(challenge);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return b64UrlFromBuffer(sig);
}

/** Sign a server challenge with the enrolled login credential. Returns a base64url raw r||s signature. */
export async function sign(challenge: string): Promise<{ credentialId: string; signature: string }> {
  const meta = await idbGet<CredentialMeta>(META_STORE, META_KEY);
  if (!meta) throw new Error('No local credential (enroll on this device first)');
  const signature = await signWithCredential(meta.credentialId, challenge);
  return { credentialId: meta.credentialId, signature };
}

/** Build a compact login_hint_token (base64url JSON of the opaque sub), no raw PII in the hint. */
export function loginHintToken(sub: string): string {
  const json = JSON.stringify({ sub });
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Remove the local login credential (paired with PSP-side revocation). */
export async function deleteCredential(): Promise<void> {
  const meta = await idbGet<CredentialMeta>(META_STORE, META_KEY);
  if (meta) await idbDelete(KEY_STORE, meta.credentialId).catch(() => {});
  await idbDelete(META_STORE, META_KEY).catch(() => {});
}

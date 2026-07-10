/**
 * Standalone ES256 key generator/downloader (v25) — a developer convenience in the merchant profile.
 *
 * IMPORTANT: these are THROWAWAY keys, distinct from the login credential in `authenticator.ts`. They are
 * generated EXTRACTABLE on purpose so they can be exported/downloaded (JWK/PEM), are NOT stored in the
 * login IndexedDB store, are NOT enrolled at the PSP, and are NOT used for authentication. Downloading them
 * therefore has no bearing on login/system security. The login credential is never exportable.
 */
'use client';

export interface GeneratedKeyPair {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
  publicPem: string;
  privatePem: string;
}

function toB64(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function pem(label: string, der: ArrayBuffer): string {
  const b64 = toB64(der);
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

/** Generate a distinct, throwaway ES256 (P-256/ECDSA) key pair, exportable for download. */
export async function generateEs256(): Promise<GeneratedKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true, // extractable: throwaway keys, not the login authenticator
    ['sign', 'verify'],
  );
  const [publicJwk, privateJwk, spki, pkcs8] = await Promise.all([
    crypto.subtle.exportKey('jwk', pair.publicKey),
    crypto.subtle.exportKey('jwk', pair.privateKey),
    crypto.subtle.exportKey('spki', pair.publicKey),
    crypto.subtle.exportKey('pkcs8', pair.privateKey),
  ]);
  return {
    publicJwk,
    privateJwk,
    publicPem: pem('PUBLIC KEY', spki),
    privatePem: pem('PRIVATE KEY', pkcs8),
  };
}

function download(filename: string, content: string, type = 'text/plain'): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Download the public key only (JWK + PEM). */
export function downloadPublic(pair: GeneratedKeyPair, stem = 'es256-public'): void {
  download(`${stem}.jwk.json`, JSON.stringify(pair.publicJwk, null, 2), 'application/json');
  download(`${stem}.pem`, pair.publicPem, 'application/x-pem-file');
}

/** Download the full key pair (public + private, JWK + PEM). */
export function downloadKeyPair(pair: GeneratedKeyPair, stem = 'es256-keypair'): void {
  download(`${stem}.public.jwk.json`, JSON.stringify(pair.publicJwk, null, 2), 'application/json');
  download(`${stem}.private.jwk.json`, JSON.stringify(pair.privateJwk, null, 2), 'application/json');
  download(`${stem}.public.pem`, pair.publicPem, 'application/x-pem-file');
  download(`${stem}.private.pem`, pair.privatePem, 'application/x-pem-file');
}

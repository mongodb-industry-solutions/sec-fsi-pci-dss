/**
 * Unit tests: polymorphic signature verifier (RS256 + ES256).
 * Source: backend/src/modules/identity/services/signatureVerifier/index.ts
 *
 * Covers: ES256 raw r||s (WebCrypto/JOSE) form, ES256 DER form, RS256, tampered-challenge and
 * wrong-key rejection. All key material is generated at runtime (nothing committed to source).
 */
import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { verifySignature } from '../../../../../psp/backend/src/modules/identity/services/signatureVerifier';

// Convert a DER ECDSA signature to raw r||s (64 bytes for P-256), mirroring WebCrypto output.
function derToRaw(der: Buffer): Buffer {
  // 0x30 len 0x02 rlen r 0x02 slen s
  let offset = 2;
  const readInt = (): Buffer => {
    offset++; // 0x02
    const len = der[offset++];
    let val = der.subarray(offset, offset + len);
    offset += len;
    if (val.length > 32) val = val.subarray(val.length - 32); // strip leading 0x00
    if (val.length < 32) val = Buffer.concat([Buffer.alloc(32 - val.length), val]); // left-pad
    return val;
  };
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

describe('verifySignature ES256', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const challenge = 'challenge-nonce-abc123';

  function signDer(): Buffer {
    return crypto.createSign('SHA256').update(Buffer.from(challenge, 'utf8')).sign(privateKey);
  }

  it('accepts a raw r||s (WebCrypto) signature', () => {
    const raw = derToRaw(signDer());
    expect(raw.length).toBe(64);
    expect(verifySignature('ES256', publicKey, challenge, raw.toString('base64url'))).toBe(true);
  });

  it('accepts a DER signature', () => {
    const der = signDer();
    expect(verifySignature('ES256', publicKey, challenge, der.toString('base64url'))).toBe(true);
  });

  it('rejects a tampered challenge', () => {
    const raw = derToRaw(signDer());
    expect(verifySignature('ES256', publicKey, 'tampered', raw.toString('base64url'))).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const other = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const der = crypto.createSign('SHA256').update(Buffer.from(challenge)).sign(other.privateKey);
    expect(verifySignature('ES256', publicKey, challenge, der.toString('base64url'))).toBe(false);
  });
});

describe('verifySignature RS256', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const challenge = 'rs256-challenge';

  it('accepts a valid RSASSA-PKCS1-v1_5 signature', () => {
    const sig = crypto.createSign('RSA-SHA256').update(Buffer.from(challenge)).sign(privateKey);
    expect(verifySignature('RS256', publicKey, challenge, sig.toString('base64url'))).toBe(true);
  });

  it('rejects a garbage signature', () => {
    expect(verifySignature('RS256', publicKey, challenge, Buffer.from('nope').toString('base64url'))).toBe(false);
  });
});

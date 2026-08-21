// polymorphic signature verifier for enrolled user authenticators (WebAuthn/FIDO2 style).
// Pure domain logic (no DB, no ports). Shared by enrollment (registration challenge) and CIBA approval.
// Verifies a signature over a server-issued challenge against a stored PUBLIC key.
//
// RS256 = RSASSA-PKCS1-v1_5 over SHA-256 (RSA-2048); universal, matches OAuth signing infra.
// ES256 = ECDSA P-256 over SHA-256; the WebAuthn default, compact signatures, best for mobile.
//
// Signature encoding: base64url. For ES256 we accept BOTH the WebCrypto/JOSE raw r||s (64-byte)
// form and the DER (ASN.1) form, since browser SubtleCrypto emits raw r||s while Node's crypto
// verify expects DER. We normalize raw -> DER before verifying.

import * as crypto from 'crypto';

export type SignatureAlg = 'RS256' | 'ES256';

function fromB64Url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

// Convert a 64-byte raw ECDSA P-256 signature (r||s) to DER. If the input is already DER
// (starts with 0x30 and is not exactly 64 bytes), it is returned unchanged.
function ecRawToDer(sig: Buffer): Buffer {
  if (sig.length !== 64) {
    return sig; // assume DER already
  }
  const r = sig.subarray(0, 32);
  const s = sig.subarray(32, 64);
  const encodeInt = (int: Buffer): Buffer => {
    let i = 0;
    while (i < int.length - 1 && int[i] === 0x00) i++; // strip leading zeros
    let trimmed = int.subarray(i);
    if (trimmed[0] & 0x80) {
      trimmed = Buffer.concat([Buffer.from([0x00]), trimmed]); // keep positive
    }
    return Buffer.concat([Buffer.from([0x02, trimmed.length]), trimmed]);
  };
  const rEnc = encodeInt(r);
  const sEnc = encodeInt(s);
  const body = Buffer.concat([rEnc, sEnc]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

/**
 * Verify `signature` (base64url) over `challenge` (the exact bytes the device signed, as a UTF-8
 * string) using the credential's PUBLIC key (SPKI PEM) and algorithm.
 * Returns true only on a valid signature; never throws on a bad signature (returns false).
 */
export function verifySignature(
  alg: SignatureAlg,
  publicKeyPem: string,
  challenge: string,
  signatureB64Url: string,
): boolean {
  try {
    const data = Buffer.from(challenge, 'utf8');
    const sig = fromB64Url(signatureB64Url);
    if (alg === 'RS256') {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(data);
      verifier.end();
      return verifier.verify(publicKeyPem, sig);
    }
    if (alg === 'ES256') {
      const verifier = crypto.createVerify('SHA256');
      verifier.update(data);
      verifier.end();
      return verifier.verify(publicKeyPem, ecRawToDer(sig));
    }
    return false;
  } catch {
    return false;
  }
}

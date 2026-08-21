/**
 * P2 (dev.v8): CHD envelope encryption (architecture §7.8). node:crypto only, no DB.
 * Validates round-trip, AAD/journey binding, tamper detection, token format, and that the token
 * leaks no plaintext.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  EnvelopeChdCrypto,
  LocalKmsKeyProvider,
  type ChdCleartext,
  type ChdContext,
} from '../../../../../psp/backend/src/vendors/encryption/chdCrypto';

const MASTER = randomBytes(96).toString('base64'); // QE local key is 96 bytes
const CLEAR: ChdCleartext = { cardNumber: '4111111111111111', cvv: '123', expiry: '12/28' };
const CTX: ChdContext = { correlationId: 'txn-1', eventType: 'card.issuer.validation.requested' };

describe('CHD envelope crypto (§7.8)', () => {
  let crypto: EnvelopeChdCrypto;
  beforeEach(() => { crypto = new EnvelopeChdCrypto(new LocalKmsKeyProvider(MASTER)); });

  it('round-trips CHD through encrypt/decrypt', async () => {
    const token = await crypto.encrypt(CLEAR, CTX);
    const back = await crypto.decrypt(token, CTX);
    expect(back).toEqual(CLEAR);
  });

  it('produces a versioned, dot-joined 6-part opaque token', async () => {
    const token = await crypto.encrypt(CLEAR, CTX);
    const parts = token.split('.');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('v1');
  });

  it('leaks no plaintext CHD in the token (confidentiality, not just integrity)', async () => {
    const token = await crypto.encrypt(CLEAR, CTX);
    expect(token).not.toContain('4111111111111111');
    expect(token).not.toContain('123');
    // decoding the ciphertext segment yields only encrypted bytes, never the PAN
    const cipherSeg = Buffer.from(token.split('.')[4], 'base64url').toString('utf8');
    expect(cipherSeg).not.toContain('4111');
  });

  it('fails to decrypt when the journey binding (AAD) differs', async () => {
    const token = await crypto.encrypt(CLEAR, CTX);
    await expect(crypto.decrypt(token, { ...CTX, correlationId: 'txn-OTHER' })).rejects.toThrow();
    await expect(crypto.decrypt(token, { ...CTX, eventType: 'other.event' })).rejects.toThrow();
  });

  it('detects tampering (auth tag mismatch)', async () => {
    const token = await crypto.encrypt(CLEAR, CTX);
    const parts = token.split('.');
    const tag = Buffer.from(parts[5], 'base64url');
    tag[0] ^= 0xff; // flip a bit in the tag
    parts[5] = tag.toString('base64url');
    await expect(crypto.decrypt(parts.join('.'), CTX)).rejects.toThrow();
  });

  it('uses a fresh DEK per message (no two tokens identical)', async () => {
    const a = await crypto.encrypt(CLEAR, CTX);
    const b = await crypto.encrypt(CLEAR, CTX);
    expect(a).not.toBe(b);
  });

  it('rejects a malformed token', async () => {
    await expect(crypto.decrypt('not-a-token', CTX)).rejects.toThrow('invalid chd token');
    await expect(crypto.decrypt('v2.a.b.c.d.e', CTX)).rejects.toThrow('invalid chd token');
  });
});

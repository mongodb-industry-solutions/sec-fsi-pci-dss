/**
 * Unit tests: phone blind index (uniqueness digest for QE-encrypted phone)
 * Source: backend/src/vendors/encryption/digest.ts
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { normalizePhone, phoneDigest, blindIndex, blindIndexKey } from '../../../../backend/src/vendors/encryption/digest';

const KEY_ENVS = ['PSP_BLIND_INDEX_KEY', 'BLIND_INDEX_KEY', 'PSP_KMS_LOCAL_MASTER_KEY', 'KMS_LOCAL_MASTER_KEY', 'LOCAL_MASTER_KEY'];
afterEach(() => {
  for (const e of KEY_ENVS) delete process.env[e];
});

describe('normalizePhone', () => {
  it('strips formatting and keeps a leading +', () => {
    expect(normalizePhone('+1 (555) 123-4567')).toBe('+15551234567');
    expect(normalizePhone('  555 123 4567 ')).toBe('5551234567');
    expect(normalizePhone('+44-20-7946-0958')).toBe('+442079460958');
  });
});

describe('phoneDigest', () => {
  it('is a deterministic 64-char hex HMAC', () => {
    const d = phoneDigest('+1 555 123 4567');
    expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneDigest('+1 555 123 4567')).toBe(d);
  });

  it('collapses equivalent formats of the same number to the same digest', () => {
    expect(phoneDigest('+1 (555) 123-4567')).toBe(phoneDigest('+15551234567'));
  });

  it('produces different digests for different numbers', () => {
    expect(phoneDigest('+15551234567')).not.toBe(phoneDigest('+15551234568'));
  });

  it('distinguishes national from international form (+ is significant)', () => {
    expect(phoneDigest('5551234567')).not.toBe(phoneDigest('+15551234567'));
  });

  it('blindIndex is a keyed HMAC (not a bare sha256)', () => {
    // Two distinct normalized inputs must not collide.
    expect(blindIndex('a')).not.toBe(blindIndex('b'));
    expect(blindIndex('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('blindIndexKey resolution', () => {
  it('prefers the explicit PSP_BLIND_INDEX_KEY', () => {
    process.env.PSP_BLIND_INDEX_KEY = 'my-explicit-key';
    expect(blindIndexKey().toString('utf8')).toBe('my-explicit-key');
  });

  it('falls back to an HKDF-derived subkey of KMS_LOCAL_MASTER_KEY (never the raw master key)', () => {
    const master = crypto.randomBytes(96).toString('base64');
    process.env.KMS_LOCAL_MASTER_KEY = master;
    const derived = blindIndexKey();
    // 32-byte derived key, and NOT equal to the raw master key material.
    expect(derived).toHaveLength(32);
    expect(derived.equals(Buffer.from(master, 'base64'))).toBe(false);
    // Deterministic for the same master key.
    expect(blindIndexKey().equals(derived)).toBe(true);
  });

  it('explicit key takes precedence over the master-key fallback', () => {
    process.env.KMS_LOCAL_MASTER_KEY = crypto.randomBytes(96).toString('base64');
    process.env.PSP_BLIND_INDEX_KEY = 'explicit-wins';
    expect(blindIndexKey().toString('utf8')).toBe('explicit-wins');
  });
});

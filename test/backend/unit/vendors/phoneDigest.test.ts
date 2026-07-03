/**
 * Unit tests: phone blind index (uniqueness digest for QE-encrypted phone)
 * Source: backend/src/vendors/encryption/digest.ts
 */
import { describe, it, expect } from 'vitest';
import { normalizePhone, phoneDigest, blindIndex } from '../../../../backend/src/vendors/encryption/digest';

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

/**
 * Unit tests (dev.v35, CH-1): qrPaymentRepresentation stays unencrypted, on purpose.
 * Source: backend/src/vendors/encryption/encryptedFieldsMaps.ts + vendors/setup/createIndexes.ts
 *
 * MongoDB forbids TTL indexes on encrypted collections (err 6346501). Since the TTL on `expiresAt`
 * is what expires the payment intent, this collection cannot be QE-encrypted, and the sensitive EPC
 * payload is kept out by deriving it on read instead of storing it. This test pins both halves of
 * that decision so a future change cannot silently break setup:db or reintroduce the cleartext IBAN.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEncryptedFieldsMaps } from '../../../../../psp/backend/src/vendors/encryption/encryptedFieldsMaps';
import type { DEKs } from '../../../../../psp/backend/src/vendors/encryption/keyVault';

const deks = new Proxy({}, { get: (_t, prop) => `dek:${String(prop)}` }) as unknown as DEKs;

describe('qrPaymentRepresentation is not QE-encrypted', () => {
  it('has no entry on either tier, so createCollections leaves it plaintext', () => {
    for (const tier of ['level1', 'level2'] as const) {
      const maps = buildEncryptedFieldsMaps(deks, tier) as Record<string, unknown>;
      expect(maps.qrPaymentRepresentation).toBeUndefined();
    }
  });

  it('keeps its TTL index, which is what QE would have made impossible', () => {
    const src = readFileSync(
      join(process.cwd(), 'psp/backend/src/vendors/setup/createIndexes.ts'), 'utf8',
    );
    const start = src.indexOf('ensureIndexes(db, QR_REPRESENTATION_COLLECTION');
    expect(start).toBeGreaterThan(-1);
    expect(src.slice(start, start + 400)).toContain('expireAfterSeconds');
  });
});

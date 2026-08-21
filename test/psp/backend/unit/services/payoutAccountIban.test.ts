/**
 * Unit tests (dev.v30.1): demo IBAN / routing generation for auto-filled payout accounts.
 * The generated IBAN must satisfy the ISO 7064 mod-97 checksum (validates to 1). Demo data only.
 */
import { describe, it, expect } from 'vitest';
import { generateDemoIban, generateDemoRouting } from '../../../../../psp/backend/src/modules/gateway/services/payoutAccount.service';

// Standard IBAN validation: move the first 4 chars to the end, map letters A-Z to 10-35, mod 97 == 1.
function ibanIsValid(iban: string): boolean {
  const s = iban.replace(/\s/g, '').toUpperCase();
  const rearranged = s.slice(4) + s.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => (ch.charCodeAt(0) - 55).toString());
  let rem = 0;
  for (const d of numeric) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

describe('generateDemoIban', () => {
  it('produces a mod-97-valid IBAN for several countries', () => {
    for (const cc of ['GB', 'DE', 'ES', 'FR', 'US', 'NL', 'PT', 'IT']) {
      const iban = generateDemoIban(cc, 'party-seed-123');
      expect(iban.slice(0, 2)).toBe(cc);
      expect(ibanIsValid(iban)).toBe(true);
    }
  });

  it('defaults to GB and stays valid when the country is missing/garbage', () => {
    expect(ibanIsValid(generateDemoIban(''))).toBe(true);
    expect(generateDemoIban('').slice(0, 2)).toBe('GB');
  });

  it('is DETERMINISTIC for a given seed (seed backfill stays idempotent, R6)', () => {
    const ref = 'pau00004-0000-4000-8000-000000000004';
    expect(generateDemoIban('ES', ref)).toBe(generateDemoIban('ES', ref));
    expect(generateDemoRouting(ref)).toBe(generateDemoRouting(ref));
    // Different seeds give different values.
    expect(generateDemoIban('ES', 'a')).not.toBe(generateDemoIban('ES', 'b'));
  });
});

describe('generateDemoRouting', () => {
  it('produces a 9-digit numeric routing number', () => {
    expect(generateDemoRouting('seed')).toMatch(/^\d{9}$/);
  });
});

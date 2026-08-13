import { describe, it, expect } from 'vitest';
import simulator from '../../../../frontend/src/config/simulator.json';

// The card issuer enforces Luhn, so a mistyped digit in the config makes that card decline with
// `14 failed_luhn_check` at demo time. Three shipped PANs were invalid; this pins the checksum.
function luhnValid(pan: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = pan.length - 1; i >= 0; i -= 1) {
    let d = pan.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return pan.length > 0 && sum % 10 === 0;
}

const digits = (v: string) => v.replace(/\D/g, '');

interface TestCard { number: string; label?: string }
const cards = (simulator as { testCards?: TestCard[] }).testCards ?? [];
const defaultCard = (simulator as { defaultCard?: string }).defaultCard;

describe('simulator card numbers', () => {
  it('ships at least one test card', () => {
    expect(cards.length).toBeGreaterThan(0);
  });

  it.each(cards.map((c) => [c.label ?? c.number, digits(c.number)] as const))(
    '%s passes the Luhn check',
    (_label, pan) => { expect(luhnValid(pan)).toBe(true); },
  );

  it('the default card passes the Luhn check', () => {
    expect(luhnValid(digits(defaultCard ?? ''))).toBe(true);
  });

  it('every label quotes its own number', () => {
    for (const c of cards) {
      const quoted = digits(c.label ?? '');
      if (quoted) expect(quoted).toBe(digits(c.number));
    }
  });
});

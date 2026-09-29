import { describe, it, expect } from 'vitest';
import simulator from '../../../../../psp/frontend/src/config/simulator.json';

// The card issuer enforces Luhn, so a mistyped digit in the config makes that card decline with
// `14 failed_luhn_check` at demo time. This pins the checksum of every PAN the config still ships.
//
// The generic test-card list and the default card are gone: the api-card flow now offers the payer's
// real cards on file, read from their own record, rather than numbers written here. What remains is
// the hosted flows' new-card prefill.
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

interface Scenario { id: string; prefill?: { cardHint?: string } }
const hints = (simulator as { scenarios: Scenario[] }).scenarios
  .filter((s) => s.prefill?.cardHint)
  .map((s) => [s.id, digits(s.prefill!.cardHint!)] as const);

describe('simulator card numbers', () => {
  it('ships no card numbers of its own outside the scenario prefills', () => {
    expect((simulator as Record<string, unknown>).testCards).toBeUndefined();
    expect((simulator as Record<string, unknown>).defaultCard).toBeUndefined();
  });

  it.each(hints)('%s prefills a card number that passes the Luhn check', (_id, pan) => {
    expect(luhnValid(pan)).toBe(true);
  });
});

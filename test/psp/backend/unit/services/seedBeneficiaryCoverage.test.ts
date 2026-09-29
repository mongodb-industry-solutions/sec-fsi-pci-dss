/**
 * Unit tests: every demo customer owns a beneficiary list.
 * Source: psp/backend/src/vendors/seed/seedCounterpartyArrangements.ts
 *
 * The curated cast carried three beneficiaries each for two customers and nothing for the other
 * fifty-four, so signing in as any other test user showed an empty list on a screen the storyline
 * walks through. The derivation closes that without touching the curated entries, which the demo
 * script names out loud.
 *
 * The minimisation rule is asserted here too: a derived entry is built from a counterparty's real
 * email or phone, and what it may persist is the masked hint only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURATED_BENEFICIARIES,
  deriveBeneficiaries,
  BENEFICIARIES_PER_OWNER,
  type BeneficiaryPartySeed,
} from '../../../../../psp/backend/src/vendors/seed/seedCounterpartyArrangements';

const DATA = join(process.cwd(), 'psp', 'backend', 'data');
const read = <T>(f: string): T[] => JSON.parse(readFileSync(join(DATA, f), 'utf-8')) as T[];

const parties = read<BeneficiaryPartySeed>('parties.json');
const agreements = read<{ partyInstanceReference: string }>('customerAgreements.json');

const derived = deriveBeneficiaries(parties, agreements, CURATED_BENEFICIARIES);
const all = [...CURATED_BENEFICIARIES, ...derived];

const owners = [...new Set(agreements.map((a) => a.partyInstanceReference))];
const countFor = (owner: string) => all.filter((b) => b.ownerPartyReference === owner).length;

describe('seeded beneficiary coverage', () => {
  it('gives every customer at least two beneficiaries', () => {
    const short = owners.filter((o) => countFor(o) < 2);
    expect(short, `owners with fewer than two beneficiaries: ${short.join(', ')}`).toEqual([]);
  });

  it('gives every customer the target count', () => {
    for (const owner of owners) {
      expect(countFor(owner), owner).toBeGreaterThanOrEqual(BENEFICIARIES_PER_OWNER);
    }
  });

  it('leaves the curated entries untouched', () => {
    for (const curated of CURATED_BENEFICIARIES) {
      expect(derived.some((d) => d.counterpartyArrangementReference === curated.counterpartyArrangementReference)).toBe(false);
    }
  });

  it('never points a beneficiary at its own owner', () => {
    const self = all.filter((b) => b.ownerPartyReference === b.counterpartyPartyReference);
    expect(self).toEqual([]);
  });

  it('resolves every counterparty to a party that exists', () => {
    const known = new Set(parties.map((p) => p.partyInstanceReference));
    const dangling = all.filter((b) => !known.has(b.counterpartyPartyReference));
    expect(dangling.map((b) => b.counterpartyArrangementReference)).toEqual([]);
  });

  it('registers each counterparty at most once per owner', () => {
    const seen = new Set<string>();
    for (const b of all) {
      const key = `${b.ownerPartyReference}:${b.counterpartyPartyReference}`;
      expect(seen.has(key), `duplicate pair ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('allocates a distinct reference to every entry', () => {
    const refs = all.map((b) => b.counterpartyArrangementReference);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('is deterministic: a second derivation is byte-for-byte the first', () => {
    expect(deriveBeneficiaries(parties, agreements, CURATED_BENEFICIARIES)).toEqual(derived);
  });

  it('stores a masked hint and never the raw email or phone', () => {
    const byRef = new Map(parties.map((p) => [p.partyInstanceReference, p]));
    for (const b of derived) {
      const party = byRef.get(b.counterpartyPartyReference)!;
      const raw = b.counterpartyLookupType === 'email' ? party.partyEmailAddress : party.partyMobilePhoneNumber;
      expect(b.counterpartyLookupHint).toContain('*');
      expect(b.counterpartyLookupHint).not.toBe(raw);
    }
  });

  it('carries the control-record identity every seeded document needs', () => {
    for (const b of derived) {
      expect(b.bianServiceDomain).toBe('Counterparty Administration');
      expect(b.bianControlRecordType).toBe('CounterpartyArrangement');
      expect(b.counterpartyArrangementStatus).toBe('active');
      expect(b.counterpartyLabel.length).toBeGreaterThan(0);
    }
  });
});

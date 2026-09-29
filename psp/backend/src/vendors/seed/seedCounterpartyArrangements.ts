import { Db } from 'mongodb';
import { createHash } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import {
  COUNTERPARTY_COLLECTION,
  CounterpartyArrangement,
  maskLookupValue,
} from '../../modules/customer/models/counterpartyArrangement.model';

/** A beneficiary as the fixtures carry it: the record minus the timestamps the seeder stamps. */
export type SeedBeneficiary = Omit<CounterpartyArrangement, 'recordCreatedDateTime' | 'recordUpdatedDateTime'>;

/** What the derivation needs off a party, which is its reference and the two lookup values. */
export interface BeneficiaryPartySeed {
  partyInstanceReference: string;
  partyName?: string;
  partyEmailAddress?: string;
  partyMobilePhoneNumber?: string;
}

/** How many beneficiaries a demo customer ends up with, curated entries included. */
export const BENEFICIARIES_PER_OWNER = 3;

// Curated beneficiaries for the two customers the demo storyline names out loud.
// Raw phone/email is NEVER stored, only masked hints and resolved partyInstanceReferences.
export const CURATED_BENEFICIARIES: SeedBeneficiary[] = [
  // ── Luis Morales (b0000001) ────────────────────────────────────────────────
  {
    counterpartyArrangementReference: 'cab00001-0000-4000-8000-000000000001',
    ownerPartyReference:      'b0000001-0000-4000-8000-000000000001',
    counterpartyPartyReference: 'b0000002-0000-4000-8000-000000000002',
    counterpartyLabel: 'Sofia (Flatmate)',
    counterpartyLookupType: 'phone',
    counterpartyLookupHint: '+34 6** *** 890',
    counterpartyArrangementStatus: 'active',
    bianServiceDomain: 'Counterparty Administration',
    bianControlRecordType: 'CounterpartyArrangement',
    schemaVersion: 1,
  },
  {
    counterpartyArrangementReference: 'cab00002-0000-4000-8000-000000000002',
    ownerPartyReference:      'b0000001-0000-4000-8000-000000000001',
    counterpartyPartyReference: 'b0000003-0000-4000-8000-000000000003',
    counterpartyLabel: 'Carlos (Brother)',
    counterpartyLookupType: 'email',
    counterpartyLookupHint: 'c***.fernandez@gmail.com',
    counterpartyArrangementStatus: 'active',
    bianServiceDomain: 'Counterparty Administration',
    bianControlRecordType: 'CounterpartyArrangement',
    schemaVersion: 1,
  },
  {
    counterpartyArrangementReference: 'cab00003-0000-4000-8000-000000000003',
    ownerPartyReference:      'b0000001-0000-4000-8000-000000000001',
    counterpartyPartyReference: 'b0000004-0000-4000-8000-000000000004',
    counterpartyLabel: 'Gym Membership Split',
    counterpartyLookupType: 'phone',
    counterpartyLookupHint: '+44 70** ***753',
    counterpartyArrangementStatus: 'active',
    bianServiceDomain: 'Counterparty Administration',
    bianControlRecordType: 'CounterpartyArrangement',
    schemaVersion: 1,
  },
  // ── Amara Diallo (b0000058) ────────────────────────────────────────────────
  {
    counterpartyArrangementReference: 'cab00004-0000-4000-8000-000000000004',
    ownerPartyReference:      'b0000058-0000-4000-8000-000000000058',
    counterpartyPartyReference: 'b0000001-0000-4000-8000-000000000001',
    counterpartyLabel: 'Luis (Colleague)',
    counterpartyLookupType: 'email',
    counterpartyLookupHint: 'l***.fernandez@back.es',
    counterpartyArrangementStatus: 'active',
    bianServiceDomain: 'Counterparty Administration',
    bianControlRecordType: 'CounterpartyArrangement',
    schemaVersion: 1,
  },
  {
    counterpartyArrangementReference: 'cab00005-0000-4000-8000-000000000005',
    ownerPartyReference:      'b0000058-0000-4000-8000-000000000058',
    counterpartyPartyReference: 'b0000005-0000-4000-8000-000000000005',
    counterpartyLabel: 'Fatou (Sister)',
    counterpartyLookupType: 'phone',
    counterpartyLookupHint: '+33 7 5* ** ** 97',
    counterpartyArrangementStatus: 'active',
    bianServiceDomain: 'Counterparty Administration',
    bianControlRecordType: 'CounterpartyArrangement',
    schemaVersion: 1,
  },
  {
    counterpartyArrangementReference: 'cab00006-0000-4000-8000-000000000006',
    ownerPartyReference:      'b0000058-0000-4000-8000-000000000058',
    counterpartyPartyReference: 'b0000006-0000-4000-8000-000000000006',
    counterpartyLabel: 'Market Vendor, Produce',
    counterpartyLookupType: 'email',
    counterpartyLookupHint: 'm***@market.ng',
    counterpartyArrangementStatus: 'active',
    bianServiceDomain: 'Counterparty Administration',
    bianControlRecordType: 'CounterpartyArrangement',
    schemaVersion: 1,
  },
];

/**
 * A stable reference for a derived entry, from the pair it stands for.
 *
 * Name-based rather than random (RFC 4122 §4.3 shape) so a reseed produces the SAME reference for
 * the same pair. The reference is the beneficiary token a payment names, so a value that churned on
 * every reseed would break every artefact that had already recorded one.
 */
function derivedReference(owner: string, counterparty: string): string {
  const h = createHash('sha1').update(`counterparty:${owner}:${counterparty}`).digest('hex');
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** The relationship labels a derived entry draws from, so a list reads like somebody's own. */
const DERIVED_LABELS = ['Family', 'Friend', 'Colleague', 'Neighbour', 'Rent Split', 'Shared Bills'];

/** The counterparty's first name, for a label a person would recognise. */
function firstNameOf(party: BeneficiaryPartySeed): string {
  return (party.partyName ?? '').trim().split(/\s+/)[0] || 'Contact';
}

/**
 * Two more beneficiaries for every customer who has fewer than the target.
 *
 * Derived rather than written down, because there are fifty-odd demo customers and a fixture file
 * listing a hundred and fifty contacts is a file nobody reviews. Pure and deterministic: the same
 * fixtures always yield the same entries, which is what makes a reseed idempotent (ADR-054).
 *
 * The curated entries are passed in and never reproduced or modified: the demo script names those
 * by label, so they are the fixed points this fills in around.
 */
export function deriveBeneficiaries(
  parties: BeneficiaryPartySeed[],
  agreements: Array<{ partyInstanceReference: string }>,
  curated: SeedBeneficiary[],
  perOwner: number = BENEFICIARIES_PER_OWNER,
): SeedBeneficiary[] {
  const byReference = new Map(parties.map((p) => [p.partyInstanceReference, p]));
  // Only a party that HOLDS an agreement is a customer, and only a customer owns a beneficiary
  // list. Ordered by the fixture so the derivation does not depend on Map iteration luck.
  const owners = [...new Set(agreements.map((a) => a.partyInstanceReference))]
    .filter((ref) => byReference.has(ref));

  // A counterparty must be resolvable to a party, and needs at least one lookup value to mask.
  const candidates = owners.filter((ref) => {
    const party = byReference.get(ref)!;
    return !!(party.partyEmailAddress || party.partyMobilePhoneNumber);
  });
  if (candidates.length < 2) return [];

  const derived: SeedBeneficiary[] = [];

  owners.forEach((owner, ownerIndex) => {
    const taken = new Set(
      curated.filter((c) => c.ownerPartyReference === owner).map((c) => c.counterpartyPartyReference),
    );
    let missing = perOwner - taken.size;
    if (missing <= 0) return;

    // Walk the candidate ring from an owner-dependent offset, so two owners do not end up with the
    // same contact list while the choice stays a function of the fixtures alone.
    for (let step = 0; step < candidates.length && missing > 0; step++) {
      const counterparty = candidates[(ownerIndex * 7 + step * 3 + 1) % candidates.length];
      if (counterparty === owner || taken.has(counterparty)) continue;
      const party = byReference.get(counterparty)!;

      // Alternate the two lookup types so both are represented, and fall back to whichever value
      // the counterparty actually has rather than masking an absent one.
      const wantsEmail = (ownerIndex + step) % 2 === 0;
      const type: 'email' | 'phone' = wantsEmail
        ? (party.partyEmailAddress ? 'email' : 'phone')
        : (party.partyMobilePhoneNumber ? 'phone' : 'email');
      const raw = type === 'email' ? party.partyEmailAddress : party.partyMobilePhoneNumber;
      if (!raw) continue;

      taken.add(counterparty);
      missing--;
      derived.push({
        counterpartyArrangementReference: derivedReference(owner, counterparty),
        ownerPartyReference: owner,
        counterpartyPartyReference: counterparty,
        counterpartyLabel: `${firstNameOf(party)} (${DERIVED_LABELS[(ownerIndex + step) % DERIVED_LABELS.length]})`,
        counterpartyLookupType: type,
        // Masked at derivation time by the same function the write path uses: the plaintext never
        // reaches the collection, so there is nothing to reveal later (GDPR Art. 5(1)(c)).
        counterpartyLookupHint: maskLookupValue(type, raw),
        counterpartyArrangementStatus: 'active',
        bianServiceDomain: 'Counterparty Administration',
        bianControlRecordType: 'CounterpartyArrangement',
        schemaVersion: 1,
      });
    }
  });

  return derived;
}

/** The fixtures the derivation reads, from the same directory every other seeder reads. */
function readFixtures(): { parties: BeneficiaryPartySeed[]; agreements: Array<{ partyInstanceReference: string }> } {
  const dir = path.join(__dirname, '../../../data');
  return {
    parties: JSON.parse(fs.readFileSync(path.join(dir, 'parties.json'), 'utf-8')),
    agreements: JSON.parse(fs.readFileSync(path.join(dir, 'customerAgreements.json'), 'utf-8')),
  };
}

export async function seedCounterpartyArrangements(db: Db) {
  const col = db.collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION);

  const { parties, agreements } = readFixtures();
  const entries = [...CURATED_BENEFICIARIES, ...deriveBeneficiaries(parties, agreements, CURATED_BENEFICIARIES)];

  let inserted = 0;
  const now = new Date();

  for (const entry of entries) {
    const exists = await col.findOne({
      counterpartyArrangementReference: entry.counterpartyArrangementReference,
    });
    if (!exists) {
      await col.insertOne({
        ...entry,
        recordCreatedDateTime: now,
        recordUpdatedDateTime: now,
      });
      inserted++;
    }
  }

  console.log(
    `  ${COUNTERPARTY_COLLECTION}: ${inserted} inserted (${entries.length - inserted} already exist)`,
  );
}

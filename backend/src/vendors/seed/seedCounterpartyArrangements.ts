import { Db } from 'mongodb';
import {
  COUNTERPARTY_COLLECTION,
  CounterpartyArrangement,
} from '../../modules/identity/models/counterpartyArrangement.model';

// Demo beneficiaries for the two most-used customers (BIAN SD-54 Counterparty Administration).
// Raw phone/email is NEVER stored, only masked hints and resolved partyInstanceReferences.
// 3 entries for Luis (b0000001) and 3 for Amara (b0000058) to support demo storyline.
const DEMO_BENEFICIARIES: Omit<CounterpartyArrangement, 'recordCreatedDateTime' | 'recordUpdatedDateTime'>[] = [
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

export async function seedCounterpartyArrangements(db: Db) {
  const col = db.collection<CounterpartyArrangement>(COUNTERPARTY_COLLECTION);

  let inserted = 0;
  const now = new Date();

  for (const entry of DEMO_BENEFICIARIES) {
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
    `  ${COUNTERPARTY_COLLECTION}: ${inserted} inserted (${DEMO_BENEFICIARIES.length - inserted} already exist)`,
  );
}

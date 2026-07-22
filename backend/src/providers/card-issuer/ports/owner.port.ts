// Owner-resolution ports (v30.1). The built-in modules (card-issuer, account-information) must not
// gain broad `customers` access (SoD, PCI Req 7). Instead they resolve ONLY the derived owner name
// server-side, gated by their own cards/accounts permission and audited (need-to-know, GDPR Art. 5).
// The party master data (SD-13) stays owned by the customer/party domain; these ports only READ a
// single display field and never mutate the party.
import { Db } from 'mongodb';
import { PARTY_COLLECTION, PartyControlRecord } from '../../../modules/identity/models/party.model';
import { CUSTOMER_AGREEMENT_COLLECTION, CustomerAgreementControlRecord } from '../../../modules/customer/models/customerAgreement.model';

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Owner (cardholder) name for a card, resolved via its agreement -> party. QE:equality field,
// decrypted server-side by the QE client. Returns null when unresolved.
export async function resolveOwnerNameByAgreement(db: Db, agreementRef: string): Promise<string | null> {
  const agreement = await db.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ customerAgreementInstanceReference: agreementRef }, { projection: { partyInstanceReference: 1 } });
  if (!agreement?.partyInstanceReference) return null;
  return resolveOwnerNameByParty(db, agreement.partyInstanceReference);
}

// Owner name for a party (used by the payout-account admin surface).
export async function resolveOwnerNameByParty(db: Db, partyRef: string): Promise<string | null> {
  const party = await db.collection<PartyControlRecord>(PARTY_COLLECTION)
    .findOne({ partyInstanceReference: partyRef }, { projection: { partyName: 1 } });
  return party?.partyName ?? null;
}

// Minimal owner search for the "assign owner" pickers. Returns agreements (card create) or parties
// (account create) with ONLY the display name + reference. Case-insensitive contains match on the
// decrypted party name. Never returns other PII.
export async function searchAgreementsByOwner(
  db: Db, query: string, limit = 10,
): Promise<Array<{ customerAgreementInstanceReference: string; partyInstanceReference: string; ownerName: string }>> {
  const parties = await matchParties(db, query, limit);
  if (!parties.length) return [];
  const byRef = new Map(parties.map((p) => [p.partyInstanceReference, p.partyName]));
  const agreements = await db.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .find({ partyInstanceReference: { $in: [...byRef.keys()] } }, { projection: { customerAgreementInstanceReference: 1, partyInstanceReference: 1 } })
    .limit(limit).toArray();
  return agreements.map((a) => ({
    customerAgreementInstanceReference: a.customerAgreementInstanceReference,
    partyInstanceReference: a.partyInstanceReference,
    ownerName: byRef.get(a.partyInstanceReference) ?? '',
  }));
}

export async function searchPartiesByOwner(
  db: Db, query: string, limit = 10,
): Promise<Array<{ partyInstanceReference: string; ownerName: string }>> {
  const parties = await matchParties(db, query, limit);
  return parties.map((p) => ({ partyInstanceReference: p.partyInstanceReference, ownerName: p.partyName }));
}

// QE:equality does not support server-side contains; decrypt-and-filter a bounded page in memory.
// Bounded scan (cap 500) keeps it safe for the demo dataset; a production system would use a
// dedicated searchable index.
async function matchParties(db: Db, query: string, limit: number): Promise<PartyControlRecord[]> {
  const q = query.trim();
  if (!q) return [];
  const rx = new RegExp(esc(q), 'i');
  const rows = await db.collection<PartyControlRecord>(PARTY_COLLECTION)
    .find({}, { projection: { partyInstanceReference: 1, partyName: 1 } }).limit(500).toArray();
  return rows.filter((p) => typeof p.partyName === 'string' && rx.test(p.partyName)).slice(0, limit);
}

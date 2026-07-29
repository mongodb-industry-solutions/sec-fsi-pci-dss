// Issuer PAN vault access (module-owned CDE, v30). All reads/writes use the QE client (fastify.db,
// Level 2) so the full PAN + service code are encrypted at rest and auto-decrypted only here. The
// PSP core never touches this collection; the core reaches it exclusively through ports.
import { Db } from 'mongodb';
import { CARD_ISSUER_VAULT_COLLECTION, CardIssuerVaultRecord } from '../models/cardIssuerVault.model';
import { DEFAULT_SERVICE_CODE } from './cardVerificationKey.service';

function coll(db: Db) {
  return db.collection<CardIssuerVaultRecord>(CARD_ISSUER_VAULT_COLLECTION);
}

export async function getVaultByCardInstance(db: Db, cardInstanceRef: string): Promise<CardIssuerVaultRecord | null> {
  return coll(db).findOne({ paymentCardInstanceReference: cardInstanceRef });
}

export async function getVaultByToken(db: Db, token: string): Promise<CardIssuerVaultRecord | null> {
  return coll(db).findOne({ paymentCardReference: token });
}

// Service code for a card, from the vault, or the demo default when the vault has no record (the
// derivation still works with the constant service code, zero CHD).
export async function getServiceCode(db: Db, cardInstanceRef: string): Promise<string> {
  const rec = await getVaultByCardInstance(db, cardInstanceRef);
  return rec?.cardServiceCode || DEFAULT_SERVICE_CODE;
}

// Ephemeral PAN reveal: returns the full PAN for a single card. Caller enforces authz + audit and
// must NOT persist or log the value. Returns null when the vault has no record for the card.
export async function revealPan(db: Db, cardInstanceRef: string): Promise<string | null> {
  const rec = await getVaultByCardInstance(db, cardInstanceRef);
  return rec?.paymentCardNumber ?? null;
}

// QE equality lookup: locate a card by its EXACT full PAN over ciphertext (no client-side scan).
// Returns display-safe identifiers only (never echoes the PAN).
export async function findByPanExact(db: Db, pan: string): Promise<Array<{ paymentCardInstanceReference: string; paymentCardReference: string; last4: string }>> {
  const rows = await coll(db).find({ paymentCardNumber: pan }).project({ _id: 0, paymentCardInstanceReference: 1, paymentCardReference: 1, paymentCardNumber: 1 }).toArray();
  return rows.map((r) => ({
    paymentCardInstanceReference: String((r as Record<string, unknown>).paymentCardInstanceReference ?? ''),
    paymentCardReference: String((r as Record<string, unknown>).paymentCardReference ?? ''),
    last4: String((r as Record<string, unknown>).paymentCardNumber ?? '').replace(/\D/g, '').slice(-4),
  }));
}

// Idempotent upsert (seed + admin). Keyed by paymentCardInstanceReference (deterministic).
export async function upsertVaultRecord(
  db: Db,
  input: {
    issuedCardInstanceReference: string;
    paymentCardReference: string;
    paymentCardInstanceReference: string;
    paymentCardNumber: string;
    cardServiceCode: string;
    cardIssuerCvkKeyId?: string;
    issuedCardStatus?: CardIssuerVaultRecord['issuedCardStatus'];
  },
): Promise<void> {
  const now = new Date();
  // QE collections reject $set on encrypted fields via updateOne in some driver paths; use a
  // delete + insert keyed by the deterministic PK to stay idempotent and QE-safe.
  await coll(db).deleteOne({ paymentCardInstanceReference: input.paymentCardInstanceReference });
  await coll(db).insertOne({
    issuedCardInstanceReference: input.issuedCardInstanceReference,
    paymentCardReference: input.paymentCardReference,
    paymentCardInstanceReference: input.paymentCardInstanceReference,
    paymentCardNumber: input.paymentCardNumber,
    cardServiceCode: input.cardServiceCode,
    ...(input.cardIssuerCvkKeyId ? { cardIssuerCvkKeyId: input.cardIssuerCvkKeyId } : {}),
    issuedCardStatus: input.issuedCardStatus ?? 'active',
    bianServiceDomain: 'Payment Card',
    bianControlRecordType: 'CardAdministration',
    recordCreatedDateTime: now,
    schemaVersion: 1,
  });
}

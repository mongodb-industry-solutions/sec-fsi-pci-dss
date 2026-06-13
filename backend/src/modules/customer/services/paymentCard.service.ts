import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  PAYMENT_CARD_COLLECTION,
  PaymentCardManagementControlRecord,
} from '../models/paymentCard.model';
import { CUSTOMER_AGREEMENT_COLLECTION, CustomerAgreementControlRecord } from '../models/customerAgreement.model';

// Resolve the customerAgreement owned by a Party (SD-13). Used to enforce that a customer can
// only manage THEIR OWN cards (PCI DSS Req 7 least privilege): the path :customerId must equal
// the agreement linked to the caller's partyRef.
export async function getOwnAgreementId(db: Db, partyRef: string | undefined): Promise<string | null> {
  if (!partyRef) return null;
  const agreement = await db.collection<CustomerAgreementControlRecord>(CUSTOMER_AGREEMENT_COLLECTION)
    .findOne({ partyInstanceReference: partyRef } as Partial<CustomerAgreementControlRecord>, { projection: { customerAgreementInstanceReference: 1 } });
  return (agreement?.customerAgreementInstanceReference as string | undefined) ?? null;
}

export interface CreateCardInput {
  customerAgreementInstanceReference: string;
  cardToken: string;
  // Optional: external/token-only payment sources may not report expiry or network.
  paymentCardExpirationDate?: string;
  paymentCardMaskedPanDisplay: string;
  paymentCardNetwork?: PaymentCardManagementControlRecord['paymentCardNetwork'];
  paymentCardIsPreferred: boolean;
  // Optional customer nickname (non-CHD display metadata) set at registration time.
  paymentCardAlias?: string;
}

export async function createCard(db: Db, input: CreateCardInput) {
  const cardId = uuidv4();
  const now = new Date();

  const card: Omit<PaymentCardManagementControlRecord, never> = {
    paymentCardInstanceReference: cardId,
    customerAgreementInstanceReference: input.customerAgreementInstanceReference,
    paymentCardReference: input.cardToken,
    paymentCardMaskedPanDisplay: input.paymentCardMaskedPanDisplay,
    paymentCardStatus: 'active',
    paymentCardIssuanceDateTime: now,
    paymentCardIsPreferred: input.paymentCardIsPreferred,
    ...(input.paymentCardExpirationDate ? { paymentCardExpirationDate: input.paymentCardExpirationDate } : {}),
    ...(input.paymentCardNetwork ? { paymentCardNetwork: input.paymentCardNetwork } : {}),
    ...(input.paymentCardAlias ? { paymentCardAlias: input.paymentCardAlias } : {}),
    bianServiceDomain: 'Payment Card',
    bianControlRecordType: 'PaymentCardManagement',
    recordCreatedDateTime: now,
    schemaVersion: 1,
  };

  await db.collection(PAYMENT_CARD_COLLECTION).insertOne(card as object);

  return {
    paymentCardInstanceReference: cardId,
    paymentCardStatus: 'active',
  };
}

// Upsert by token — creates if not exists, otherwise updates expiry/maskedPan
export async function upsertCardByToken(db: Db, input: CreateCardInput): Promise<{ paymentCardInstanceReference: string }> {
  const now = new Date();
  const existing = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION)
    .findOne({ paymentCardReference: input.cardToken });

  if (existing) {
    // Only refresh fields we actually have; never wipe an existing expiry/network with blanks.
    const set: Record<string, unknown> = { paymentCardMaskedPanDisplay: input.paymentCardMaskedPanDisplay, recordUpdatedDateTime: now };
    if (input.paymentCardExpirationDate) set.paymentCardExpirationDate = input.paymentCardExpirationDate;
    if (input.paymentCardNetwork) set.paymentCardNetwork = input.paymentCardNetwork;
    await db.collection(PAYMENT_CARD_COLLECTION).updateOne(
      { paymentCardReference: input.cardToken },
      { $set: set }
    );
    return { paymentCardInstanceReference: existing.paymentCardInstanceReference };
  }

  const result = await createCard(db, input);
  return { paymentCardInstanceReference: result.paymentCardInstanceReference };
}

// Soft-delete (PCI DSS Req 10: never lose the audit history). The card is marked `revoked`
// and its recurring mandate cancelled; it is filtered out of the customer's list but the
// record is retained. Scoped by customerRef so a card can only be revoked by its owner.
// Returns true if a matching active card was revoked.
export async function revokeCard(db: Db, customerRef: string, cardId: string): Promise<boolean> {
  const res = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION).updateOne(
    { paymentCardInstanceReference: cardId, customerAgreementInstanceReference: customerRef, paymentCardStatus: { $ne: 'revoked' } },
    { $set: { paymentCardStatus: 'revoked', paymentCardMandateStatus: 'cancelled', recordUpdatedDateTime: new Date() } },
  );
  return res.matchedCount > 0;
}

export async function getCardsByCustomer(db: Db, customerRef: string) {
  const results = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION)
    // Revoked (customer-removed) cards are retained for audit but excluded from the list.
    .find({ customerAgreementInstanceReference: customerRef, paymentCardStatus: { $ne: 'revoked' } })
    // List projection: display-safe fields plus the surrogate token (non-CHD, used to pay with a
    // saved card and to correlate transactions). The QE:none expiry is NOT included here — it is
    // returned only by the per-card detail endpoint.
    .project({
      paymentCardInstanceReference: 1,
      paymentCardReference: 1,
      paymentCardMaskedPanDisplay: 1,
      paymentCardNetwork: 1,
      paymentCardStatus: 1,
      paymentCardIsPreferred: 1,
      paymentCardAlias: 1,
      recordCreatedDateTime: 1,
    })
    .sort({ paymentCardIsPreferred: -1, recordCreatedDateTime: -1 })
    .toArray();

  return { results };
}

// Look up a card-on-file by its surrogate token (token is unique per card). Used by the PSP
// authorization gate and the transaction path to reject operations on a deactivated/removed card.
// Returns the lifecycle status and identifiers only (no expiry, no CHD).
export async function getCardByToken(db: Db, token: string) {
  return db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION).findOne(
    { paymentCardReference: token },
    { projection: { _id: 0, paymentCardInstanceReference: 1, customerAgreementInstanceReference: 1, paymentCardStatus: 1, paymentCardMaskedPanDisplay: 1, paymentCardNetwork: 1 } },
  );
}

// Customer activation toggle: a customer may DEACTIVATE an active card (active -> suspended) or
// REACTIVATE a suspended one (suspended -> active). A suspended card stays on file (NOT removed)
// but the PSP rejects every operation with it, regardless of what the issuer says. Other statuses
// (expired / blocked by issuer / revoked) are NOT customer-toggleable. Scoped by customerRef.
// Returns the updated card detail, or null if no card matched the required current status.
export async function setCardActivation(db: Db, customerRef: string, cardId: string, active: boolean) {
  const target = active ? 'active' : 'suspended';
  const requiredCurrent = active ? 'suspended' : 'active';
  const res = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION).updateOne(
    { paymentCardInstanceReference: cardId, customerAgreementInstanceReference: customerRef, paymentCardStatus: requiredCurrent },
    { $set: { paymentCardStatus: target, recordUpdatedDateTime: new Date() } },
  );
  if (res.matchedCount === 0) return null;
  return getCardById(db, customerRef, cardId);
}

// Per-card detail for the OWNER's self-service view. Scoped by customerRef so a customer can only
// read their own card. Returns the surrogate token, the QE:none expiry, lifecycle dates and the
// customer-defined alias/note. CVV/PIN are never stored, so are never returned. Null if not found.
export async function getCardById(db: Db, customerRef: string, cardId: string) {
  const card = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION)
    .findOne(
      { paymentCardInstanceReference: cardId, customerAgreementInstanceReference: customerRef, paymentCardStatus: { $ne: 'revoked' } },
      { projection: { _id: 0 } },
    );
  return card;
}

// Update the ONLY customer-editable attributes: the alias (nickname) and the free-text note.
// Both are non-CHD display metadata. Scoped by customerRef (ownership). Returns the updated card
// (detail shape) or null if no matching active card exists.
export async function updateCardMetadata(
  db: Db,
  customerRef: string,
  cardId: string,
  patch: { paymentCardAlias?: string; paymentCardCustomerNote?: string },
) {
  const set: Record<string, unknown> = { recordUpdatedDateTime: new Date() };
  if (patch.paymentCardAlias !== undefined) set.paymentCardAlias = patch.paymentCardAlias;
  if (patch.paymentCardCustomerNote !== undefined) set.paymentCardCustomerNote = patch.paymentCardCustomerNote;

  const res = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION).updateOne(
    { paymentCardInstanceReference: cardId, customerAgreementInstanceReference: customerRef, paymentCardStatus: { $ne: 'revoked' } },
    { $set: set },
  );
  if (res.matchedCount === 0) return null;
  return getCardById(db, customerRef, cardId);
}


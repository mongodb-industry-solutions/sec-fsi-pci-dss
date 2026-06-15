import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  PAYMENT_CARD_COLLECTION,
  PaymentCardManagementControlRecord,
} from '../models/paymentCard.model';
import {
  PAYMENT_CARD_REGISTRY_COLLECTION,
  PaymentCardRegistryRecord,
  SHARED_CARD_HOLDER_THRESHOLD,
} from '../models/paymentCardRegistry.model';
import { CUSTOMER_AGREEMENT_COLLECTION, CustomerAgreementControlRecord } from '../models/customerAgreement.model';
import { emitComplianceEvent } from '../../providers/services/businessProcessEvent.service';

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

// Upsert the per-customer card-on-file arrangement, keyed by (customer, token). The same physical
// card (deterministic token) for the same customer is never duplicated; a different customer using
// the same card gets their own arrangement row and is added to the shared registry. Used by the
// payment auto-registration path.
export async function upsertCardByToken(db: Db, input: CreateCardInput): Promise<{ paymentCardInstanceReference: string; created: boolean }> {
  const now = new Date();
  const existing = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION)
    .findOne({ paymentCardReference: input.cardToken, customerAgreementInstanceReference: input.customerAgreementInstanceReference });

  let cardId: string;
  let created = false;
  if (existing) {
    // Only refresh fields we actually have; never wipe an existing expiry/network with blanks.
    const set: Record<string, unknown> = { paymentCardMaskedPanDisplay: input.paymentCardMaskedPanDisplay, recordUpdatedDateTime: now };
    if (input.paymentCardExpirationDate) set.paymentCardExpirationDate = input.paymentCardExpirationDate;
    if (input.paymentCardNetwork) set.paymentCardNetwork = input.paymentCardNetwork;
    await db.collection(PAYMENT_CARD_COLLECTION).updateOne(
      { paymentCardInstanceReference: existing.paymentCardInstanceReference },
      { $set: set }
    );
    cardId = existing.paymentCardInstanceReference;
  } else {
    const result = await createCard(db, input);
    cardId = result.paymentCardInstanceReference;
    created = true;
  }

  await syncCardRegistry(db, input.cardToken);
  return { paymentCardInstanceReference: cardId, created };
}

// Soft-delete (PCI DSS Req 10: never lose the audit history). The card is marked `revoked`
// and its recurring mandate cancelled; it is filtered out of the customer's list but the
// record is retained. Scoped by customerRef so a card can only be revoked by its owner.
// Returns true if a matching active card was revoked.
export async function revokeCard(db: Db, customerRef: string, cardId: string): Promise<boolean> {
  const card = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION).findOne(
    { paymentCardInstanceReference: cardId, customerAgreementInstanceReference: customerRef, paymentCardStatus: { $ne: 'revoked' } },
    { projection: { paymentCardReference: 1 } },
  );
  if (!card) return false;
  await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION).updateOne(
    { paymentCardInstanceReference: cardId, customerAgreementInstanceReference: customerRef },
    { $set: { paymentCardStatus: 'revoked', paymentCardMandateStatus: 'cancelled', recordUpdatedDateTime: new Date() } },
  );
  // The holder dropped off this card → recompute the shared registry / holder count.
  await syncCardRegistry(db, card.paymentCardReference);
  return true;
}

// ---- Physical-card registry (SD-88, ADR-027): one doc per token; FDS/AML shared-card signal -----

// Recompute the registry entry for a token from its non-revoked arrangements: the set of distinct
// holders and the holder count. Emits a compliance event when the card crosses the shared-card
// threshold (a money-mule / shared-card indicator). Idempotent and cheap (few rows per token).
export async function syncCardRegistry(db: Db, token: string): Promise<{ cardHolderCount: number }> {
  const arrangements = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION)
    .find({ paymentCardReference: token, paymentCardStatus: { $ne: 'revoked' } })
    .project({ customerAgreementInstanceReference: 1, paymentCardMaskedPanDisplay: 1, paymentCardNetwork: 1 })
    .toArray();

  const reg = db.collection<PaymentCardRegistryRecord>(PAYMENT_CARD_REGISTRY_COLLECTION);
  const prev = await reg.findOne({ paymentCardReference: token }, { projection: { cardHolderCount: 1 } });

  const holders = [...new Set(arrangements.map((a) => a.customerAgreementInstanceReference as string))];
  const now = new Date();

  if (holders.length === 0) {
    // No active holders left — drop the registry entry (the card is no longer on file anywhere).
    await reg.deleteOne({ paymentCardReference: token });
    return { cardHolderCount: 0 };
  }

  const sample = arrangements[0];
  await reg.updateOne(
    { paymentCardReference: token },
    {
      $set: {
        paymentCardMaskedPanDisplay: sample?.paymentCardMaskedPanDisplay as string,
        paymentCardNetwork: sample?.paymentCardNetwork as PaymentCardRegistryRecord['paymentCardNetwork'],
        cardHolderAgreementReferences: holders,
        cardHolderCount: holders.length,
        recordUpdatedDateTime: now,
        bianServiceDomain: 'Payment Card',
        bianControlRecordType: 'PaymentCardRegistry',
        schemaVersion: 1,
      },
      $setOnInsert: {
        paymentCardRegistryInstanceReference: uuidv4(),
        paymentCardReference: token,
        firstRegisteredDateTime: now,
      },
    },
    { upsert: true },
  );

  // FDS/AML: flag when a card is newly shared beyond the threshold (only on upward crossing).
  const prevCount = prev?.cardHolderCount ?? 0;
  if (holders.length > SHARED_CARD_HOLDER_THRESHOLD && prevCount <= SHARED_CARD_HOLDER_THRESHOLD) {
    emitComplianceEvent(db, {
      entityType: 'card',
      entityId: token,
      processType: 'card_management',
      processAction: 'card.shared_threshold_exceeded',
      processOutcome: 'escalated',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: { maskedPan: sample?.paymentCardMaskedPanDisplay, network: sample?.paymentCardNetwork, holderCount: holders.length, threshold: SHARED_CARD_HOLDER_THRESHOLD },
      bianServiceDomain: 'Payment Card',
      bianControlRecordType: 'PaymentCardRegistry',
    });
  }

  return { cardHolderCount: holders.length };
}

// Holder count for a token (FDS/AML). Reads the registry (O(1)); 0/1 if not yet registered.
export async function getCardHolderCount(db: Db, token: string): Promise<number> {
  const reg = await db.collection<PaymentCardRegistryRecord>(PAYMENT_CARD_REGISTRY_COLLECTION)
    .findOne({ paymentCardReference: token }, { projection: { cardHolderCount: 1 } });
  return reg?.cardHolderCount ?? 0;
}

// Investigation view (L1/L2/auditor): the physical card and WHO holds it. The holder agreement
// references are non-PII identifiers; resolving them to identities requires the customer endpoints.
export async function getCardRegistryByToken(db: Db, token: string) {
  return db.collection<PaymentCardRegistryRecord>(PAYMENT_CARD_REGISTRY_COLLECTION)
    .findOne({ paymentCardReference: token }, { projection: { _id: 0 } });
}

// Customer self-service register with dedup (POST /cards). A customer cannot duplicate a card they
// already hold: re-adding the same card returns the existing arrangement (reused=true); re-adding a
// previously removed card reactivates it. Otherwise a new arrangement is created. Registry synced.
export async function registerCardForCustomer(db: Db, input: CreateCardInput): Promise<{ paymentCardInstanceReference: string; paymentCardStatus: string; reused: boolean }> {
  const coll = db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION);
  const existing = await coll.findOne({ paymentCardReference: input.cardToken, customerAgreementInstanceReference: input.customerAgreementInstanceReference });

  let cardId: string;
  let status = 'active';
  let reused = false;

  if (existing && existing.paymentCardStatus !== 'revoked') {
    cardId = existing.paymentCardInstanceReference;
    status = existing.paymentCardStatus;
    reused = true; // already on file for this customer — do not duplicate
  } else if (existing && existing.paymentCardStatus === 'revoked') {
    // Re-register a previously removed card: reactivate and refresh details.
    const set: Record<string, unknown> = { paymentCardStatus: 'active', paymentCardMandateStatus: 'active', recordUpdatedDateTime: new Date() };
    if (input.paymentCardExpirationDate) set.paymentCardExpirationDate = input.paymentCardExpirationDate;
    if (input.paymentCardNetwork) set.paymentCardNetwork = input.paymentCardNetwork;
    if (input.paymentCardAlias) set.paymentCardAlias = input.paymentCardAlias;
    if (input.paymentCardIsPreferred) set.paymentCardIsPreferred = true;
    await coll.updateOne({ paymentCardInstanceReference: existing.paymentCardInstanceReference }, { $set: set });
    cardId = existing.paymentCardInstanceReference;
  } else {
    const result = await createCard(db, input);
    cardId = result.paymentCardInstanceReference;
  }

  await syncCardRegistry(db, input.cardToken);
  return { paymentCardInstanceReference: cardId, paymentCardStatus: status, reused };
}

// Auditor Data Integrity (PCI DSS Req 10): detect card records that are duplicated by error.
//   - duplicateArrangements: the same (customer, token) stored more than once (a hard duplicate).
//   - tokenizationDuplicates: one customer holding the same masked PAN + network under DIFFERENT
//     tokens (the same physical card duplicated because of inconsistent/non-deterministic tokens).
//   - registryDrift: registry holder counts that disagree with the live arrangements.
// Aggregates + masked PAN only (no CHD/PII). Sampled to keep the payload small.
export async function getCardIntegrity(db: Db) {
  const coll = db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION);

  const duplicateArrangements = await coll.aggregate([
    { $match: { paymentCardStatus: { $ne: 'revoked' } } },
    { $group: { _id: { c: '$customerAgreementInstanceReference', t: '$paymentCardReference' }, count: { $sum: 1 }, masked: { $first: '$paymentCardMaskedPanDisplay' } } },
    { $match: { count: { $gt: 1 } } },
    { $project: { _id: 0, maskedPan: '$masked', count: 1 } },
    { $limit: 50 },
  ]).toArray();

  const tokenizationDuplicates = await coll.aggregate([
    { $match: { paymentCardStatus: { $ne: 'revoked' } } },
    { $group: { _id: { c: '$customerAgreementInstanceReference', m: '$paymentCardMaskedPanDisplay', n: '$paymentCardNetwork' }, tokens: { $addToSet: '$paymentCardReference' } } },
    { $match: { 'tokens.1': { $exists: true } } }, // 2+ distinct tokens for the same masked card
    { $project: { _id: 0, maskedPan: '$_id.m', network: '$_id.n', distinctTokens: { $size: '$tokens' } } },
    { $limit: 50 },
  ]).toArray();

  const reg = db.collection<PaymentCardRegistryRecord>(PAYMENT_CARD_REGISTRY_COLLECTION);
  const liveHolders = await coll.aggregate([
    { $match: { paymentCardStatus: { $ne: 'revoked' } } },
    { $group: { _id: '$paymentCardReference', holders: { $addToSet: '$customerAgreementInstanceReference' } } },
  ]).toArray();
  const liveMap = new Map(liveHolders.map((h) => [h._id as string, (h.holders as string[]).length]));
  const regDocs = await reg.find({}, { projection: { _id: 0, paymentCardReference: 1, cardHolderCount: 1, paymentCardMaskedPanDisplay: 1 } }).toArray();
  const registryDrift = regDocs
    .filter((r) => (liveMap.get(r.paymentCardReference) ?? 0) !== r.cardHolderCount)
    .slice(0, 50)
    .map((r) => ({ maskedPan: r.paymentCardMaskedPanDisplay, registryCount: r.cardHolderCount, liveCount: liveMap.get(r.paymentCardReference) ?? 0 }));

  return {
    duplicateArrangementCount: duplicateArrangements.length,
    duplicateArrangements,
    tokenizationDuplicateCount: tokenizationDuplicates.length,
    tokenizationDuplicates,
    registryDriftCount: registryDrift.length,
    registryDrift,
    healthy: duplicateArrangements.length === 0 && tokenizationDuplicates.length === 0 && registryDrift.length === 0,
  };
}

// Rebuild the entire registry from the live arrangements (seed-time / maintenance).
export async function rebuildCardRegistry(db: Db): Promise<number> {
  // QE-encrypted collections do NOT support the `distinct` command (the driver attaches
  // `distinct.encryptionInformation`, which the server / crypt_shared rejects). Use an aggregation
  // `$group` on the (non-encrypted) surrogate token instead — supported on QE collections.
  const grouped = await db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION)
    .aggregate([{ $group: { _id: '$paymentCardReference' } }])
    .toArray();
  const tokens = grouped.map((g) => g._id as string).filter(Boolean);
  for (const token of tokens) await syncCardRegistry(db, token);
  return tokens.length;
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

// Look up a card-on-file by its surrogate token. The token is deterministic per PAN, so the same
// physical card maps to the same token; a card-on-file is therefore keyed by (customer, token).
// Pass `customerRef` to scope to one customer (the correct per-customer view); omit for a
// best-effort global check. Returns lifecycle status + identifiers only (no expiry, no CHD).
export async function getCardByToken(db: Db, token: string, customerRef?: string) {
  const filter: Record<string, unknown> = { paymentCardReference: token };
  if (customerRef) filter.customerAgreementInstanceReference = customerRef;
  return db.collection<PaymentCardManagementControlRecord>(PAYMENT_CARD_COLLECTION).findOne(
    filter,
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


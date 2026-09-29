import { Db } from 'mongodb';
import { randomUUID } from 'node:crypto';
import {
  CARD_ISSUER_VAULT_COLLECTION, ISSUED_CARD_REGISTRY_COLLECTION,
  CardIssuerVaultRecord, IssuedCardRegistryRecord, IssuedCardStatus, IssuedCardLimits,
} from '../models/cardIssuerVault.model';
import { IssuedCardView, toIssuedCardView } from './issuedCardView';
import { BANK_PROFILE_COLLECTION } from '../../aspsp/models/bankProfile.model';
import { luhnValid } from './cardValidation.service';
import { DEFAULT_SERVICE_CODE } from '../../../vendors/encryption/cardVerificationKey.service';

// The card lifecycle: issue, activate, block, replace, renew, and the limits an authorisation is judged
// against. All of it the issuer's, because all of it is about a card this bank put in someone's hands.

// Which transitions are legal. Revoked is terminal: a revoked card is not un-revoked, it is replaced, which
// is what keeps a card's history readable instead of letting one token mean two different things over time.
const ALLOWED_TRANSITIONS: Record<IssuedCardStatus, IssuedCardStatus[]> = {
  issued: ['active', 'revoked'],
  active: ['suspended', 'revoked'],
  suspended: ['active', 'revoked'],
  revoked: [],
};

export async function findIssuedCard(db: Db, cardToken: string): Promise<IssuedCardView | null> {
  const record = await db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION)
    .findOne({ paymentCardReference: cardToken }, { projection: { _id: 0 } });
  return record ? toIssuedCardView(record) : null;
}

// ── Issuing ──────────────────────────────────────────────────────────────────────────────────────

interface BinRange { binRangeFrom: string; binRangeTo: string; binRangeScheme?: string }

const NETWORK_LENGTH: Record<string, number> = { VISA: 16, MASTERCARD: 16, AMEX: 15, ELO: 16 };

async function binRangeFor(db: Db, network: string): Promise<BinRange | undefined> {
  const profile = await db.collection<{ bankProfileBinRanges?: BinRange[] }>(BANK_PROFILE_COLLECTION).findOne({});
  const ranges = profile?.bankProfileBinRanges ?? [];
  return ranges.find((range) => range.binRangeScheme?.toUpperCase() === network.toUpperCase());
}

function randomDigits(count: number): string {
  let out = '';
  while (out.length < count) out += Math.floor(Math.random() * 10).toString();
  return out.slice(0, count);
}

// A number inside one of this bank's declared ranges, with a Luhn check digit, so the card it issues is
// routable back to it. A number outside every range would be unroutable: nothing could name its issuer.
function mintPan(bin: string, length: number): string {
  const body = `${bin}${randomDigits(Math.max(0, length - bin.length - 1))}`;
  for (let digit = 0; digit < 10; digit += 1) {
    const candidate = `${body}${digit}`;
    if (luhnValid(candidate)) return candidate;
  }
  // Unreachable: exactly one check digit satisfies Luhn for any given body.
  throw new Error('could not compute a check digit');
}

export type IssueRefusal = 'unsupported_network' | 'card_token_in_use' | 'no_bin_range';

export async function issueCard(db: Db, input: {
  network: string;
  accountHolderReference?: string;
  fundingAccountReference?: string;
  expiryMonth: string;
  expiryYear: string;
  cardToken?: string;
  limits?: IssuedCardLimits;
}): Promise<{ ok: true; card: IssuedCardView } | { ok: false; refusal: IssueRefusal }> {
  const network = input.network.toUpperCase();
  const length = NETWORK_LENGTH[network];
  if (!length) return { ok: false, refusal: 'unsupported_network' };

  const range = await binRangeFor(db, network);
  if (!range) return { ok: false, refusal: 'no_bin_range' };

  const cardToken = input.cardToken ?? `pm_${randomUUID().replace(/-/g, '').slice(0, 28)}`;
  const existing = await db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION)
    .findOne({ paymentCardReference: cardToken }, { projection: { _id: 1 } });
  if (existing) return { ok: false, refusal: 'card_token_in_use' };

  // Spread across the declared range rather than always taking its first BIN.
  const span = Number(range.binRangeTo) - Number(range.binRangeFrom) + 1;
  const bin = String(Number(range.binRangeFrom) + Math.floor(Math.random() * Math.max(1, span)))
    .padStart(range.binRangeFrom.length, '0');
  const pan = mintPan(bin, length);
  const lastFour = pan.slice(-4);
  const now = new Date().toISOString();

  await db.collection<CardIssuerVaultRecord>(CARD_ISSUER_VAULT_COLLECTION).insertOne({
    issuedCardInstanceReference: `iss_${randomUUID()}`,
    paymentCardReference: cardToken,
    paymentCardInstanceReference: cardToken,
    paymentCardNumber: pan,
    cardServiceCode: DEFAULT_SERVICE_CODE,
    cardIssuerCvkKeyId: 'cvk-card-issuer-cvk',
    // Issued, not active: a card is activated by whoever receives it, which is the point of the two states.
    issuedCardStatus: 'issued',
    bianServiceDomain: 'Card Administration',
    bianControlRecordType: 'CardAdministration',
    recordCreatedDateTime: now,
    schemaVersion: 1,
  });

  const record: IssuedCardRegistryRecord = {
    issuedCardRegistryInstanceReference: `reg_${randomUUID()}`,
    paymentCardReference: cardToken,
    accountHolderInstanceReference: input.accountHolderReference,
    accountArrangementInstanceReference: input.fundingAccountReference,
    paymentCardNetwork: network,
    // Debit, stored rather than inferred: a credit card will arrive as a different value here, and a record
    // that only means debit because the reader assumes it cannot express that.
    paymentCardKind: 'debit',
    paymentCardBin: bin,
    paymentCardLastFour: lastFour,
    paymentCardMaskedDisplay: `****-****-****-${lastFour}`,
    paymentCardExpiryMonth: input.expiryMonth,
    paymentCardExpiryYear: input.expiryYear,
    issuedCardStatus: 'issued',
    ...(input.limits ? { issuedCardLimits: input.limits } : {}),
    bianServiceDomain: 'Payment Card',
    bianControlRecordType: 'IssuedCardRegistry',
    recordCreatedDateTime: now,
    schemaVersion: 1,
  };
  await db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION).insertOne(record);
  return { ok: true, card: toIssuedCardView(record) };
}

// ── Status ───────────────────────────────────────────────────────────────────────────────────────

export type StatusRefusal = 'unknown_card' | 'transition_not_allowed';

/** Both records move together: a status on one and not the other is a card in two states at once. */
export async function changeCardStatus(
  db: Db, cardToken: string, target: IssuedCardStatus,
): Promise<{ ok: true; card: IssuedCardView } | { ok: false; refusal: StatusRefusal; from?: IssuedCardStatus }> {
  const current = await findIssuedCard(db, cardToken);
  if (!current) return { ok: false, refusal: 'unknown_card' };
  if (current.status === target) return { ok: true, card: current };
  if (!ALLOWED_TRANSITIONS[current.status].includes(target)) {
    return { ok: false, refusal: 'transition_not_allowed', from: current.status };
  }

  const now = new Date().toISOString();
  await db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION).updateOne(
    { paymentCardReference: cardToken },
    { $set: { issuedCardStatus: target, recordUpdatedDateTime: now } },
  );
  // The vault carries the status too, so the validation path can refuse a blocked card without a second read.
  await db.collection<CardIssuerVaultRecord>(CARD_ISSUER_VAULT_COLLECTION).updateOne(
    { paymentCardReference: cardToken },
    { $set: { issuedCardStatus: target, recordUpdatedDateTime: now } },
  );
  return { ok: true, card: { ...current, status: target } };
}

// ── Renewal and replacement ──────────────────────────────────────────────────────────────────────

/**
 * Renewal: same card, later expiry. The token and the number are unchanged, which is what makes a renewal
 * invisible to everything holding the token. The verification value DOES change, since the expiry feeds it.
 */
export async function renewCard(
  db: Db, cardToken: string, expiry: { month: string; year: string },
): Promise<{ ok: true; card: IssuedCardView } | { ok: false; refusal: StatusRefusal }> {
  const current = await findIssuedCard(db, cardToken);
  if (!current) return { ok: false, refusal: 'unknown_card' };
  if (current.status === 'revoked') return { ok: false, refusal: 'transition_not_allowed' };

  await db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION).updateOne(
    { paymentCardReference: cardToken },
    {
      $set: {
        paymentCardExpiryMonth: expiry.month,
        paymentCardExpiryYear: expiry.year,
        recordUpdatedDateTime: new Date().toISOString(),
      },
    },
  );
  return { ok: true, card: { ...current, expiryMonth: expiry.month, expiryYear: expiry.year } };
}

/**
 * Replacement: a NEW card, and the old one revoked. A lost card's number must stop working, so this is
 * deliberately not a renewal: the new card has its own token, its own number and its own verification value.
 */
export async function replaceCard(
  db: Db, cardToken: string, expiry?: { month: string; year: string },
): Promise<{ ok: true; replacement: IssuedCardView; replaced: string } | { ok: false; refusal: StatusRefusal | IssueRefusal }> {
  const current = await db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION)
    .findOne({ paymentCardReference: cardToken }, { projection: { _id: 0 } });
  if (!current) return { ok: false, refusal: 'unknown_card' };

  const issued = await issueCard(db, {
    network: current.paymentCardNetwork,
    accountHolderReference: current.accountHolderInstanceReference,
    fundingAccountReference: current.accountArrangementInstanceReference,
    expiryMonth: expiry?.month ?? current.paymentCardExpiryMonth ?? '12',
    expiryYear: expiry?.year ?? current.paymentCardExpiryYear ?? '30',
    limits: current.issuedCardLimits,
  });
  if (!issued.ok) return issued;

  // Revoke second: if issuing fails the holder still has a working card, which is the safer order.
  const revoked = await changeCardStatus(db, cardToken, 'revoked');
  if (!revoked.ok && revoked.refusal === 'transition_not_allowed') {
    // Already revoked, which is fine: the replacement stands.
  }
  await db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION).updateOne(
    { paymentCardReference: issued.card.cardToken },
    { $set: { replacesPaymentCardReference: cardToken } },
  );
  return { ok: true, replacement: issued.card, replaced: cardToken };
}

// ── Limits ───────────────────────────────────────────────────────────────────────────────────────

export async function setCardLimits(
  db: Db, cardToken: string, limits: IssuedCardLimits,
): Promise<{ ok: true; card: IssuedCardView } | { ok: false; refusal: 'unknown_card' }> {
  const result = await db.collection<IssuedCardRegistryRecord>(ISSUED_CARD_REGISTRY_COLLECTION).updateOne(
    { paymentCardReference: cardToken },
    { $set: { issuedCardLimits: limits, recordUpdatedDateTime: new Date().toISOString() } },
  );
  if (result.matchedCount === 0) return { ok: false, refusal: 'unknown_card' };
  const card = await findIssuedCard(db, cardToken);
  return { ok: true, card: card! };
}

// ISO 8583: 61 is "exceeds withdrawal amount limit", 62 "restricted card", 54 "expired card".
export type CardAuthorisationRefusal =
  | { code: '14'; reason: 'unknown_card' }
  | { code: '62'; reason: 'card_not_active' }
  | { code: '54'; reason: 'expired' }
  | { code: '61'; reason: 'exceeds_transaction_limit' }
  | { code: '12'; reason: 'currency_mismatch' };

/**
 * What the issuer checks about the CARD before it looks at the money: is it active, is it in date, does the
 * amount fit the limit set on it. An unknown token is NOT refused here: a card the PSP presents that this
 * bank never issued is judged on the account alone, which is how a mixed estate keeps working.
 */
export function judgeCardForAuthorisation(
  card: IssuedCardView | null, amount: number, currency: string, now = new Date(),
): CardAuthorisationRefusal | null {
  if (!card) return null;
  if (card.status !== 'active') return { code: '62', reason: 'card_not_active' };

  if (card.expiryMonth && card.expiryYear) {
    const year = card.expiryYear.length === 2 ? 2000 + Number(card.expiryYear) : Number(card.expiryYear);
    // Valid through the end of the expiry month.
    if (now.getTime() >= Date.UTC(year, Number(card.expiryMonth), 1)) return { code: '54', reason: 'expired' };
  }

  const limits = card.limits;
  if (limits?.perTransactionAmount !== undefined) {
    if (limits.limitCurrency && limits.limitCurrency !== currency) {
      return { code: '12', reason: 'currency_mismatch' };
    }
    if (amount > limits.perTransactionAmount) return { code: '61', reason: 'exceeds_transaction_limit' };
  }
  return null;
}

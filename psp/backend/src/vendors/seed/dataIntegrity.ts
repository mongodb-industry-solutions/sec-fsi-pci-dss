/**
 * v33: pure, fixture-level integrity repairs shared by BOTH halves of the seed pipeline (P7):
 * the generator (`bin/seed-generate.ts`, which persists the result into `psp/backend/data/*.json`) and
 * the runtime seeders (`seedUsers`, `seedTransactions`, which apply them as an idempotent safety
 * net). Nothing here touches a database or a filesystem, so it is directly unit-testable.
 *
 * The invariants encoded here:
 *  - F1: every `customer` party owns exactly one authentication record.
 *  - F3: every transaction points at an card held by the same party, and the masked
 *    PAN on the transaction equals the one derived from that card.
 *  - F2/D-3: every `customer` party is complete (agreement with a completed KYC status, a card,
 *    a payout account, a transaction).
 *
 * Every derived identifier comes from `deterministicReference`, so a regeneration or a reseed is
 * idempotent: the same input population always produces the same output records.
 */
import { createHash } from 'crypto';
import { deriveMaskedPan } from '../../modules/customer/models/paymentCard.model';
import type { ResidentialAddress } from '../../modules/customer/models/customerAgreement.model';
// Single source of truth for the deterministic seed, shared with the KYC screening engine and
// seedCustomers. Do not add a second hash here (P8: reuse before creation).
import { screeningHash } from '../../providers/kyc/services/hrpScreening.service';

// ── Shared record shapes ──────────────────────────────────────────────────────
// Deliberately loose: these functions operate on seed fixtures, which carry the control-record
// fields plus whatever curated extras a demo scenario needs. Only the fields actually read are
// declared, so a fixture is never rejected for carrying more than the invariant needs.

export interface PartySeed {
  partyInstanceReference: string;
  partyType?: string;
  partyName?: string;
  partyEmailAddress?: string;
  [key: string]: unknown;
}

export interface AuthenticationSeed {
  customerAuthenticationInstanceReference: string;
  partyInstanceReference: string;
  customerAuthenticationEmailAddress?: string;
  customerAuthenticationCredentialHash?: string;
  customerAuthenticationUserRole?: string;
  customerAuthenticationUserName?: string;
  customerAuthenticationDemoFeatured?: boolean;
  [key: string]: unknown;
}

export interface AgreementSeed {
  customerAgreementInstanceReference: string;
  partyInstanceReference: string;
  customerAgreementReference: string;
  [key: string]: unknown;
}

export interface CardSeed {
  paymentCardInstanceReference: string;
  customerAgreementInstanceReference: string;
  paymentCardReference: string;
  paymentCardMaskedPanDisplay?: string;
  paymentCardBin?: string;
  paymentCardLast4?: string;
  paymentCardStatus?: string;
  paymentCardIsPreferred?: boolean;
  fundingPayoutAccountInstanceReference?: string;
  [key: string]: unknown;
}

export interface TransactionSeed {
  cardTransactionInstanceReference: string;
  paymentCardReference: string;
  cardTransactionAccountReference: string;
  cardTransactionMaskedPanDisplay?: string;
  [key: string]: unknown;
}

export interface PayoutAccountSeed {
  payoutAccountInstanceReference: string;
  partyInstanceReference: string;
  payoutAccountType?: string;
  payoutAccountStatus?: string;
  payoutAccountIsDefault?: boolean;
  [key: string]: unknown;
}

export interface FraudCaseSeed {
  cardTransactionInstanceReference?: string;
  transactionSnapshot?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── Deterministic identifiers ─────────────────────────────────────────────────

/**
 * A UUID-shaped identifier derived from a namespace and a seed string. Not RFC-4122 random, but
 * RFC-4122 *shaped* (version nibble 4, variant 10xx), so it is indistinguishable from the random
 * references already in the fixtures while staying stable across regenerations.
 */
export function deterministicReference(namespace: string, seed: string): string {
  const h = createHash('sha256').update(`${namespace}:${seed}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return [h.slice(0, 8), h.slice(8, 12), `4${h.slice(13, 16)}`, `${variant}${h.slice(17, 20)}`, h.slice(20, 32)].join('-');
}

/** Stable non-negative hash for picking deterministically from a vocabulary (djb2, reused). */
export const seedHash = screeningHash;

const pick = <T>(list: readonly T[], seed: number, shift = 0): T => list[(seed >>> shift) % list.length];

// ── F1: a login for every customer party ──────────────────────────────────────


// v39: deriveCustomerLogins is gone. This service derives no logins, because it holds no principals:
// a login for every customer is the identity authority s to seed, from its own fixtures.


// ── F3: the transaction-to-card link ──────────────────────────────────────────

export interface RepointSummary {
  repointed: number;
  maskedPanAligned: number;
  unresolvable: string[];
}

/**
 * Repoints every transaction at a real card token held by the SAME party, and aligns the masked PAN
 * on the transaction with the card it now points at.
 *
 * Repointing (rather than inventing the missing cards) removes the orphans without inflating the card
 * population, and it makes the masked PAN on the transaction consistent with its card.
 *
 * Card preference, deterministic: a token unique to this holder first (a token shared by several
 * holders is the FDS/AML shared-card signal and would make a token-only lookup ambiguous), then the
 * preferred card, then an active one, then the lowest instance reference.
 *
 * A transaction already pointing at a card of its own party is left alone; only its masked PAN is
 * aligned. Mutates in place and returns a summary.
 */
export function repointTransactionsToCards(
  transactions: TransactionSeed[],
  cards: readonly CardSeed[],
  agreements: readonly AgreementSeed[],
): RepointSummary {
  const agreementByBusinessRef = new Map(agreements.map((a) => [a.customerAgreementReference, a]));
  const holdersByToken = new Map<string, number>();
  for (const card of cards) {
    holdersByToken.set(card.paymentCardReference, (holdersByToken.get(card.paymentCardReference) ?? 0) + 1);
  }

  const cardsByAgreement = new Map<string, CardSeed[]>();
  for (const card of cards) {
    const list = cardsByAgreement.get(card.customerAgreementInstanceReference) ?? [];
    list.push(card);
    cardsByAgreement.set(card.customerAgreementInstanceReference, list);
  }

  const summary: RepointSummary = { repointed: 0, maskedPanAligned: 0, unresolvable: [] };

  for (const txn of transactions) {
    const agreement = agreementByBusinessRef.get(txn.cardTransactionAccountReference);
    if (!agreement) {
      summary.unresolvable.push(txn.cardTransactionInstanceReference);
      continue;
    }
    const held = cardsByAgreement.get(agreement.customerAgreementInstanceReference) ?? [];
    if (held.length === 0) {
      summary.unresolvable.push(txn.cardTransactionInstanceReference);
      continue;
    }

    let card = held.find((c) => c.paymentCardReference === txn.paymentCardReference);
    if (!card) {
      card = [...held].sort(byCardPreference(holdersByToken))[0];
      txn.paymentCardReference = card.paymentCardReference;
      summary.repointed++;
    }

    const masked = deriveMaskedPan(card);
    if (masked && txn.cardTransactionMaskedPanDisplay !== masked) {
      txn.cardTransactionMaskedPanDisplay = masked;
      summary.maskedPanAligned++;
    }
  }
  return summary;
}

const byCardPreference =
  (holdersByToken: Map<string, number>) =>
  (a: CardSeed, b: CardSeed): number => {
    const shared = (c: CardSeed) => ((holdersByToken.get(c.paymentCardReference) ?? 1) > 1 ? 1 : 0);
    const preferred = (c: CardSeed) => (c.paymentCardIsPreferred ? 0 : 1);
    const active = (c: CardSeed) => (c.paymentCardStatus === 'active' ? 0 : 1);
    return (
      shared(a) - shared(b) ||
      preferred(a) - preferred(b) ||
      active(a) - active(b) ||
      a.paymentCardInstanceReference.localeCompare(b.paymentCardInstanceReference)
    );
  };

/**
 * Realigns the immutable-looking transaction snapshot a fraud case carries with the transaction it
 * points at, so repointing a card never leaves a case showing a masked PAN its transaction no longer
 * has. Only fields already present on the snapshot are refreshed.
 */
export function syncFraudCaseSnapshots(
  cases: FraudCaseSeed[],
  transactions: readonly TransactionSeed[],
): number {
  const byRef = new Map(transactions.map((t) => [t.cardTransactionInstanceReference, t]));
  let synced = 0;
  for (const c of cases) {
    const snapshot = c.transactionSnapshot;
    const txn = c.cardTransactionInstanceReference ? byRef.get(c.cardTransactionInstanceReference) : undefined;
    if (!snapshot || !txn) continue;
    if (
      'cardTransactionMaskedPanDisplay' in snapshot &&
      snapshot.cardTransactionMaskedPanDisplay !== txn.cardTransactionMaskedPanDisplay
    ) {
      snapshot.cardTransactionMaskedPanDisplay = txn.cardTransactionMaskedPanDisplay;
      synced++;
    }
  }
  return synced;
}

// ── F2 / D-3: complete every customer party ───────────────────────────────────

const AGREEMENT_NAMESPACE = 'v33:customerAgreement';
const CARD_NAMESPACE = 'v33:paymentCard';
const TRANSACTION_NAMESPACE = 'v33:cardTransaction';

const NETWORKS = ['VISA', 'MASTERCARD', 'AMEX', 'ELO'] as const;
const SEGMENTS = ['retail', 'premium', 'corporate', 'sme'] as const;
const CHANNELS = ['online', 'pos', 'contactless', 'atm'] as const;
const CARD_ALIASES = ['Everyday', 'Personal', 'Travel', 'Online shopping'] as const;
const MCC_LIST = ['5812', '5411', '5912', '5734', '5999', '4814', '7372'] as const;
const MERCHANTS = [
  'Leafy Grocers', 'Northwind Travel', 'Bluebell Pharmacy', 'Orbit Electronics',
  'Corner Bakery', 'Metro Transit', 'Cloudline Software', 'Harbour Books',
] as const;
// Every completed customer gets at least one status that makes the self-service view interesting
// (a dispute or a decline), so a presenter signing in as a customer has something to look at.
const INTERESTING_STATUSES = ['disputed', 'declined'] as const;

export interface CompletionAdditions {
  agreements: AgreementSeed[];
  cards: CardSeed[];
  transactions: TransactionSeed[];
}

export interface CompletionOptions {
  /** Anchor for the generated transaction dates. Defaults to now. */
  now?: Date;
  /** Transactions to create per customer that has none. */
  transactionsPerCustomer?: number;
}

/**
 * Fills every structural gap in the customer population (D-3: no customer left partial). For each
 * `customer` party it creates only what is missing: an agreement with a completed KYC status,
 * an card funded by an account the party already owns, and a few transactions.
 *
 * Deliberately modest volumes: the aim is a complete customer, not a busy one. Existing records are
 * never modified. Payout accounts are NOT created here, they are curated demo data ; a party
 * without one gets no card, and the integrity test reports it rather than this inventing an account.
 *
 * @returns the new records only; the caller appends them to the population.
 */
export function completeCustomerPopulation(
  parties: readonly PartySeed[],
  agreements: readonly AgreementSeed[],
  cards: readonly CardSeed[],
  transactions: readonly TransactionSeed[],
  payoutAccounts: readonly PayoutAccountSeed[],
  options: CompletionOptions = {},
): CompletionAdditions {
  const now = options.now ?? new Date();
  const perCustomer = options.transactionsPerCustomer ?? 3;

  const agreementByParty = new Map(agreements.map((a) => [a.partyInstanceReference, a]));
  const takenBusinessRefs = new Set(agreements.map((a) => a.customerAgreementReference));
  const agreementsWithCard = new Set(cards.map((c) => c.customerAgreementInstanceReference));
  const accountsWithTransaction = new Set(transactions.map((t) => t.cardTransactionAccountReference));

  const additions: CompletionAdditions = { agreements: [], cards: [], transactions: [] };

  for (const party of parties) {
    if (party.partyType !== 'customer') continue;
    const seed = seedHash(party.partyInstanceReference);

    let agreement = agreementByParty.get(party.partyInstanceReference);
    if (!agreement) {
      agreement = buildAgreement(party, seed, takenBusinessRefs, now);
      takenBusinessRefs.add(agreement.customerAgreementReference);
      additions.agreements.push(agreement);
    }

    let heldCards = cards.filter((c) => c.customerAgreementInstanceReference === agreement.customerAgreementInstanceReference);
    if (!agreementsWithCard.has(agreement.customerAgreementInstanceReference)) {
      const funding = defaultAccountFor(party.partyInstanceReference, payoutAccounts);
      // No payout account means no funding source; a card without one would break the
      // cardAccountReference invariant, so leave the gap visible instead.
      if (funding) {
        const card = buildCard(agreement, seed, funding, now);
        additions.cards.push(card);
        agreementsWithCard.add(agreement.customerAgreementInstanceReference);
        heldCards = [card];
      }
    }

    if (!accountsWithTransaction.has(agreement.customerAgreementReference) && heldCards.length > 0) {
      const card = heldCards[0];
      for (let i = 0; i < perCustomer; i++) {
        additions.transactions.push(buildTransaction(agreement, card, seed, i, perCustomer, now));
      }
      accountsWithTransaction.add(agreement.customerAgreementReference);
    }
  }
  return additions;
}

function buildAgreement(party: PartySeed, seed: number, taken: Set<string>, now: Date): AgreementSeed {
  // Initials plus a deterministic discriminator, matching the curated ACC-XX-YYYYMMDD shape closely
  // enough to read naturally in the UI while staying collision-free.
  const initials = String(party.partyName ?? 'XX')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 3) || 'XX';
  let ref = `ACC-${initials}-${String(seed % 100000000).padStart(8, '0')}`;
  let bump = 0;
  while (taken.has(ref)) ref = `ACC-${initials}-${String((seed + ++bump) % 100000000).padStart(8, '0')}`;

  const enrollment = new Date(now.getTime() - (180 + (seed % 540)) * 86400000);
  return {
    customerAgreementInstanceReference: deterministicReference(AGREEMENT_NAMESPACE, party.partyInstanceReference),
    partyInstanceReference: party.partyInstanceReference,
    customerAgreementReference: ref,
    customerSegment: pick(SEGMENTS, seed, 3),
    customerAgreementStatus: 'active',
    customerAgreementEnrollmentDate: enrollment.toISOString(),
    customerAgreementPreferredLanguage: 'en',
    customerAgreementResidentialAddress: residentialAddressFrom(party, seed),
    // The remaining KYC leaves (structured government ID, TIN, occupation, provider verdicts) are
    // filled deterministically by enrichKyc in seedCustomers, the single source for that logic.
    customerAgreementKycCheck: {
      customerAgreementKycCheckStatus: 'verified',
      customerAgreementKycCheckCompletedDate: enrollment.toISOString(),
      customerAgreementKycCheckReference: `KYC-${String(seed.toString(16)).toUpperCase().padStart(8, '0').slice(0, 8)}`,
      customerAgreementKycCheckNotes: 'Identity verified via document check at onboarding',
    },
    bianServiceDomain: 'Customer Agreement',
    bianControlRecordType: 'CustomerAgreementProcedure',
    recordCreatedDateTime: enrollment.toISOString(),
    recordUpdatedDateTime: now.toISOString(),
    schemaVersion: 3,
  };
}

/**
 * The ResidentialAddress, derived from the party's postal address so the two agree.
 * The two sub-documents use different field names (`line1` vs `streetAddress`), so they are mapped
 * explicitly rather than copied.
 */
function residentialAddressFrom(party: PartySeed, seed: number): ResidentialAddress {
  const postal = party.partyPostalAddress as Partial<Record<string, string>> | undefined;
  return {
    streetAddress: postal?.line1 ?? postal?.streetAddress ?? `${1 + (seed % 200)} High Street`,
    city: postal?.city ?? 'London',
    postalCode: postal?.postalCode ?? 'EC1A 1BB',
    countryCode: postal?.countryCode ?? 'GB',
  };
}

function buildCard(agreement: AgreementSeed, seed: number, fundingAccountRef: string, now: Date): CardSeed {
  const issued = new Date(now.getTime() - (60 + (seed % 300)) * 86400000);
  const last4 = String(seed % 10000).padStart(4, '0');
  const expiryYear = (now.getFullYear() + 3) % 100;
  return {
    paymentCardInstanceReference: deterministicReference(CARD_NAMESPACE, agreement.customerAgreementInstanceReference),
    customerAgreementInstanceReference: agreement.customerAgreementInstanceReference,
    // Same `pm_<hex>` surrogate shape the tokenization service issues , derived rather than
    // random so a regeneration is idempotent.
    paymentCardReference: `pm_${deterministicReference(CARD_NAMESPACE, `token:${agreement.customerAgreementInstanceReference}`)
      .replace(/-/g, '')
      .slice(0, 16)}`,
    paymentCardExpirationDate: `${String(1 + (seed % 12)).padStart(2, '0')}/${String(expiryYear).padStart(2, '0')}`,
    paymentCardMaskedPanDisplay: `****-****-****-${last4}`,
    paymentCardNetwork: pick(NETWORKS, seed, 5),
    paymentCardStatus: 'active',
    paymentCardIssuanceDateTime: issued.toISOString(),
    paymentCardIsPreferred: true,
    paymentCardAlias: pick(CARD_ALIASES, seed, 7),
    fundingPayoutAccountInstanceReference: fundingAccountRef,
    bianServiceDomain: 'Payment Card',
    bianControlRecordType: 'PaymentCardManagement',
    recordCreatedDateTime: issued.toISOString(),
    schemaVersion: 1,
  };
}

function buildTransaction(
  agreement: AgreementSeed,
  card: CardSeed,
  seed: number,
  index: number,
  total: number,
  now: Date,
): TransactionSeed {
  const s = seed + index * 7919;
  const when = new Date(now.getTime() - (2 + ((s % 40) * (index + 1))) * 86400000);
  const amount = parseFloat((15 + ((s % 47000) / 100)).toFixed(2));
  const merchant = pick(MERCHANTS, s, 2);
  // The last transaction of the set is the interesting one (a dispute or a decline).
  const status = index === total - 1 ? pick(INTERESTING_STATUSES, s, 4) : (s % 3 === 0 ? 'authorized' : 'settled');
  return {
    cardTransactionInstanceReference: deterministicReference(
      TRANSACTION_NAMESPACE,
      `${agreement.customerAgreementInstanceReference}:${index}`,
    ),
    paymentCardReference: card.paymentCardReference,
    cardTransactionAccountReference: agreement.customerAgreementReference,
    cardTransactionAmount: { amount, currency: 'EUR' },
    cardTransactionDateTime: when.toISOString(),
    cardTransactionStatus: status,
    cardTransactionType: 'purchase',
    cardTransactionChannel: pick(CHANNELS, s, 6),
    cardTransactionInitiationType: 'customerInitiated',
    cardTransactionMerchantCategoryCode: pick(MCC_LIST, s, 8),
    cardTransactionMerchantName: merchant,
    cardTransactionMaskedPanDisplay: deriveMaskedPan(card),
    cardTransactionDescription: merchant.toUpperCase().slice(0, 22),
    cardTransactionNarrative: `PURCHASE at ${merchant} - ref ${s.toString(16).toUpperCase().slice(0, 8)}`,
    bianServiceDomain: 'Card Transaction',
    bianControlRecordType: 'CardTransactionLog',
    recordCreatedDateTime: when.toISOString(),
    recordUpdatedDateTime: now.toISOString(),
    schemaVersion: 3,
  };
}

/** The party's default active account, bank_account preferred, mirroring the seedCards linking rule. */
function defaultAccountFor(partyRef: string, accounts: readonly PayoutAccountSeed[]): string | undefined {
  const owned = accounts.filter((a) => a.partyInstanceReference === partyRef && a.payoutAccountStatus === 'active');
  const rank = (a: PayoutAccountSeed) =>
    (a.payoutAccountIsDefault ? 0 : 1) * 10 + (a.payoutAccountType === 'bank_account' ? 0 : 1);
  return [...owned].sort((a, b) => rank(a) - rank(b) || a.payoutAccountInstanceReference.localeCompare(b.payoutAccountInstanceReference))[0]
    ?.payoutAccountInstanceReference;
}

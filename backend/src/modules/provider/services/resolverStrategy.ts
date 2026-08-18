import { Db } from 'mongodb';
import { IntegrationProviderType, ExternalProviderArrangement } from '../models/externalProviderArrangement.model';
import { getActiveProvidersForType } from './integrationRegistry.service';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../../gateway/models/payoutAccount.model';
import { PAYMENT_CARD_COLLECTION } from '../../customer/models/paymentCard.model';

// How a provider is CHOSEN, per capability.
//
// Routing already existed (primary_fallback, round_robin, weighted, parallel). What was missing is that the
// routing KEY differs per capability, and getting that wrong is not a degradation, it is sending a payment to
// the wrong bank:
//   · ASPSP, AIS and PIS route BY THE DATA: the institution that holds the account in question.
//   · Card issuer routes by the card's issuer, derived from its BIN.
//   · FDS, AML, HRP, VoP, KYC, KYB and the credit bureau route BY STRATEGY: any active provider will do,
//     and which one is a matter of priority, weight or round-robin.
//
// The resolvers are pluggable; the dispatch pipeline is NOT. Five capability-specific controllers would fork
// the audit trail that carries the compliance narrative, so this injects a resolver behind the one dispatch
// path rather than duplicating it.

export type ResolverKind = 'entity_bound' | 'strategy_bound';

// Which capabilities are bound to an entity, and therefore must never be resolved by strategy. A strategy
// resolver on any of these would pick "an" ASPSP rather than "the" ASPSP.
const ENTITY_BOUND: Partial<Record<IntegrationProviderType, ResolverKind>> = {
  aspsp: 'entity_bound',
  account_information: 'entity_bound',
  payment_initiation: 'entity_bound',
  card_issuer: 'entity_bound',
  card_authorization: 'entity_bound',
};

export function resolverKindFor(type: IntegrationProviderType): ResolverKind {
  return ENTITY_BOUND[type] ?? 'strategy_bound';
}

export interface ResolutionContext {
  // The account whose institution must serve the request. For a PAYMENT this is the DEBTOR's account, never
  // the creditor's: see the note on `resolveByAccountAspsp`.
  accountReference?: string;
  // A card token, when the capability is bound to the card's issuer.
  cardToken?: string;
  // Coordinates for something not yet linked, which is the account-linking moment: the platform has to work
  // out which registered institution owns an identifier the user just typed.
  iban?: string;
  cardNumberBin?: string;
}

export type Resolution =
  | { ok: true; provider: ExternalProviderArrangement; kind: ResolverKind; reason: string }
  // A refusal, never a fallback. The distinction matters: falling back to another provider for an
  // entity-bound capability means operating the wrong institution's account.
  | { ok: false; kind: ResolverKind; reason: string };

/**
 * The institution that holds a given account.
 *
 * **The routing key is the DEBTOR, never the creditor.** For a payment, the provider is the bank that holds
 * the PAYER's account, because that is the institution which must execute the debit. From the creditor's IBAN
 * the PSP derives only the payment PRODUCT, which is a separate derivation from a possibly different IBAN.
 * Conflating the two would dispatch a payment to the recipient's bank, which Leafy Pay has no relationship
 * with and cannot reach: it is not a clearing participant.
 */
export async function resolveByAccountAspsp(
  db: Db,
  type: IntegrationProviderType,
  context: ResolutionContext,
): Promise<Resolution> {
  const kind: ResolverKind = 'entity_bound';
  const providers = await getActiveProvidersForType(db, type);

  // A LINKED account carries its institution on the record, so the resolver never guesses (P6.3c).
  if (context.accountReference) {
    const account = await db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
      .findOne({ payoutAccountInstanceReference: context.accountReference });
    if (!account) return { ok: false, kind, reason: `no such account: ${context.accountReference}` };
    const aspsp = account.payoutAccountAspspReference;
    if (!aspsp) {
      // An account with no institution is not routable, and a default would be the wrong bank.
      return { ok: false, kind, reason: 'the account names no ASPSP, so nothing can be routed to it' };
    }
    const match = providers.find((provider) => provider.externalProviderAspspReference === aspsp);
    if (!match) return { ok: false, kind, reason: `no active ${type} provider serves ASPSP ${aspsp}` };
    return { ok: true, provider: match, kind, reason: `linked account at ${aspsp}` };
  }

  // A NEWLY ENTERED account has no link yet, which is the linking moment (P6.3a): the owning institution is
  // derived from the IBAN's own bank code, matched against what each provider declares it serves.
  if (context.iban) {
    const code = ibanBankCodeOf(context.iban);
    if (!code) return { ok: false, kind, reason: 'the IBAN carries no recognisable bank code' };
    const match = providers.find((provider) => (provider.externalProviderIbanBankCodes ?? []).includes(code));
    // Refused with the reason, never routed to a default (P6.3b): an identifier nobody claims is not
    // something to guess about.
    if (!match) return { ok: false, kind, reason: `no registered institution owns IBAN bank code ${code}` };
    return { ok: true, provider: match, kind, reason: `IBAN bank code ${code}` };
  }

  return { ok: false, kind, reason: 'no account reference and no IBAN: nothing to resolve an institution from' };
}

/** The issuer of a card, from its token when it is registered or its BIN when it has just been typed. */
export async function resolveByCardIssuer(
  db: Db,
  type: IntegrationProviderType,
  context: ResolutionContext,
): Promise<Resolution> {
  const kind: ResolverKind = 'entity_bound';
  const providers = await getActiveProvidersForType(db, type);

  let bin = context.cardNumberBin;
  if (!bin && context.cardToken) {
    const card = await db.collection<{ paymentCardBin?: string; paymentCardIssuerReference?: string }>(PAYMENT_CARD_COLLECTION)
      .findOne({ paymentCardReference: context.cardToken }, { projection: { paymentCardBin: 1, paymentCardIssuerReference: 1 } });
    if (!card) return { ok: false, kind, reason: `no such card token` };
    // The issuer on the record wins over the BIN: a registered card was already resolved once, and
    // re-deriving it would let a BIN range change silently move an existing card to another issuer.
    if (card.paymentCardIssuerReference) {
      const match = providers.find((provider) => provider.externalProviderAspspReference === card.paymentCardIssuerReference);
      if (!match) return { ok: false, kind, reason: `no active ${type} provider serves issuer ${card.paymentCardIssuerReference}` };
      return { ok: true, provider: match, kind, reason: `registered card issuer ${card.paymentCardIssuerReference}` };
    }
    bin = card.paymentCardBin;
  }
  if (!bin) return { ok: false, kind, reason: 'no BIN and no registered issuer: nothing to resolve from' };

  const match = providers.find((provider) => (provider.externalProviderBinRanges ?? [])
    .some((range) => withinBinRange(bin!, range.binRangeFrom, range.binRangeTo)));
  if (!match) return { ok: false, kind, reason: `no registered issuer covers BIN ${bin}` };
  return { ok: true, provider: match, kind, reason: `BIN ${bin}` };
}

/**
 * Any active provider of the capability, ordered as the registry orders them.
 *
 * Legitimate ONLY for a capability where any provider can answer: a fraud score, a sanctions screen, an AML
 * check. The existing routing strategies (primary/fallback, weighted, round-robin) apply on top of this.
 */
export async function resolveByStrategy(
  db: Db,
  type: IntegrationProviderType,
): Promise<Resolution> {
  const kind: ResolverKind = 'strategy_bound';
  const providers = await getActiveProvidersForType(db, type);
  const provider = providers[0];
  if (!provider) return { ok: false, kind, reason: `no active ${type} provider` };
  return { ok: true, provider, kind, reason: 'first active provider by registry order' };
}

/**
 * The single entry point: picks the resolver the capability requires.
 *
 * A capability the resolved institution does not offer fails with a reason rather than falling back to
 * another provider (P6.4). For an entity-bound capability a fallback is not a degraded answer, it is the
 * wrong bank.
 */
export async function resolveProvider(
  db: Db,
  type: IntegrationProviderType,
  context: ResolutionContext = {},
): Promise<Resolution> {
  switch (resolverKindFor(type)) {
    case 'entity_bound':
      return type === 'card_issuer' || type === 'card_authorization'
        ? resolveByCardIssuer(db, type, context)
        : resolveByAccountAspsp(db, type, context);
    default:
      return resolveByStrategy(db, type);
  }
}

// ── Identifier derivation ────────────────────────────────────────────────────────────────────────

// ISO 13616 national bank identifier lengths, per country. The same table the bank uses, because both sides
// have to agree on what "the bank code" means for a given IBAN.
const IBAN_BANK_CODE_LENGTH: Record<string, number> = {
  ES: 4, FR: 5, GB: 4, NL: 4, DE: 8, IT: 5, PT: 4, IE: 4, BE: 3, AT: 5,
};

export function ibanBankCodeOf(iban: string): string | null {
  const normalised = iban.replace(/\s/g, '').toUpperCase();
  const country = normalised.slice(0, 2);
  const length = IBAN_BANK_CODE_LENGTH[country];
  if (!length || normalised.length < 4 + length) return null;
  return normalised.slice(4, 4 + length);
}

/** Inclusive digit-string comparison, so ranges of different lengths compare correctly. */
export function withinBinRange(bin: string, from: string, to: string): boolean {
  const width = Math.max(from.length, to.length);
  const candidate = bin.slice(0, width).padEnd(width, '0');
  return candidate >= from.padEnd(width, '0') && candidate <= to.padEnd(width, '9');
}

// Hexagonal ports for the built-in card-issuer module (ADR-029). The module never reads core
// collections directly; it depends on these ports. In a microservice extraction they are replaced
// by an API/event contract without touching the module's domain logic.
import { Db } from 'mongodb';
import { getCardByToken, getCardByIdAny } from '../../../modules/customer/services/paymentCard.service';
import { getPayoutAccount } from '../../../modules/gateway/services/payoutAccount.service';

// Non-CHD view of a core card-on-file, resolved for the issuer engine (token surrogate + display
// data). Never carries the full PAN or CVV.
export interface CardReferenceView {
  paymentCardInstanceReference: string;
  customerAgreementInstanceReference?: string;
  paymentCardReference: string;
  paymentCardExpirationDate?: string;
  paymentCardNetwork?: string | null;
  paymentCardStatus: string;
  paymentCardBin?: string | null;
  paymentCardLast4?: string | null;
  fundingPayoutAccountInstanceReference?: string | null;
}

// Card Reference port: resolve a card-on-file by token (used by validation) or by id (admin).
export async function resolveCardByToken(db: Db, token: string): Promise<CardReferenceView | null> {
  const card = await getCardByToken(db, token);
  if (!card) return null;
  return toView(card as Record<string, unknown>);
}

export async function resolveCardById(db: Db, cardId: string): Promise<CardReferenceView | null> {
  const card = await getCardByIdAny(db, cardId);
  if (!card) return null;
  return toView(card as Record<string, unknown>);
}

function toView(card: Record<string, unknown>): CardReferenceView {
  return {
    paymentCardInstanceReference: String(card.paymentCardInstanceReference ?? ''),
    customerAgreementInstanceReference: (card.customerAgreementInstanceReference as string | undefined) ?? undefined,
    paymentCardReference: String(card.paymentCardReference ?? ''),
    paymentCardExpirationDate: card.paymentCardExpirationDate as string | undefined,
    paymentCardNetwork: (card.paymentCardNetwork as string | undefined) ?? null,
    paymentCardStatus: String(card.paymentCardStatus ?? ''),
    paymentCardBin: (card.paymentCardBin as string | undefined) ?? null,
    paymentCardLast4: (card.paymentCardLast4 as string | undefined) ?? null,
    fundingPayoutAccountInstanceReference: (card.fundingPayoutAccountInstanceReference as string | undefined) ?? null,
  };
}

// Funding Account port (QE-stripped, display-safe): resolve the payout account that funds a card.
// The IBAN/routing (QE:none) are NEVER included here; only the display attributes.
export interface FundingAccountView {
  payoutAccountInstanceReference: string;
  payoutAccountAlias?: string;
  payoutAccountBankName?: string;
  payoutAccountCurrency?: string;
  payoutAccountStatus?: string;
  payoutAccountHasIban: boolean;
}

export async function resolveFundingAccount(db: Db, payoutAccountRef: string): Promise<FundingAccountView | null> {
  const acc = await getPayoutAccount(db, payoutAccountRef);
  if (!acc) return null;
  const a = acc as unknown as Record<string, unknown>;
  return {
    payoutAccountInstanceReference: String(a.payoutAccountInstanceReference ?? ''),
    payoutAccountAlias: a.payoutAccountAlias as string | undefined,
    payoutAccountBankName: a.payoutAccountBankName as string | undefined,
    payoutAccountCurrency: a.payoutAccountCurrency as string | undefined,
    payoutAccountStatus: a.payoutAccountStatus as string | undefined,
    payoutAccountHasIban: !!a.payoutAccountIban,
  };
}

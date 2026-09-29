import { Db } from 'mongodb';
import {
  dispatchByStrategy, dispatchToInstitution, type DispatchResult,
} from '../../modules/provider/services/integrationDispatch.service';
import type { BusinessContextRef } from '../../modules/provider/models/externalProviderArrangement.model';
import type {
  EntityBoundProviderType, ResolutionContext, StrategyBoundProviderType,
} from '../../modules/provider/services/resolverStrategy';

// How each capability group reaches its registered providers.
//
// The groups are NOT interchangeable, and the difference is not a detail of configuration: it is whether the
// provider is a matter of preference or a matter of fact.
//
//   · A fraud score, a sanctions screen, an identity check: ANY active provider can answer. Which one is a
//     question of priority, weight or round-robin, and a second opinion is a valid answer.
//   · A card validation, an authorisation, an account read, a payment initiation: only ONE institution can
//     answer, the one that issued that card or holds that account. Asking another is not a degraded answer,
//     it is asking a stranger about somebody else's money.
//
// That distinction used to live only in a lookup table consulted deep inside the dispatch pipeline, with the
// routing key passed as an optional argument. Every one of the six institution-bound call sites omitted it, so
// the resolvers that pick the owning bank had never run: the routing was dead code that typechecked, and with
// one bank registered nothing looked wrong.
//
// So it is a type hierarchy instead. An institution-bound group cannot be written without saying how to find
// its institution, because `routingKeyFor` is abstract, and it cannot dispatch without one, because the base
// class refuses instead. Adding a capability to the bound set makes the compiler demand the same of it.
//
// The dispatch PIPELINE stays single behind all of them. Capability-specific pipelines would fork the audit
// trail that carries the compliance narrative; what specialises here is the choice of provider and the
// contract each group imposes on its caller, never the logging, the events or the field mapping.

/** What a group is asked. The fields a given group needs are named by its own `routingKeyFor`. */
export interface GroupRequest {
  event: string;
  payload: Record<string, unknown>;
  businessContext?: BusinessContextRef;
  /** Where the request is about: a card, an account, or an identifier just entered. */
  subject?: {
    cardToken?: string;
    cardNumberBin?: string;
    accountReference?: string;
    iban?: string;
  };
}

export abstract class CapabilityGroup {
  constructor(protected readonly db: Db) {}

  abstract ask(request: GroupRequest): Promise<DispatchResult>;
}

/**
 * A group whose provider is decided by WHOSE the entity is.
 *
 * The subclass names the routing key and nothing else. When the key cannot be produced the request is refused
 * with the reason, because the alternative is asking an institution about an entity it does not hold, and it
 * would answer "unknown" in a way indistinguishable from a genuine decline.
 */
export abstract class InstitutionBoundGroup extends CapabilityGroup {
  protected abstract readonly capability: EntityBoundProviderType;

  /** The identifier that names the owning institution, or null when the request does not carry one. */
  protected abstract routingKeyFor(subject: GroupRequest['subject']): ResolutionContext | null;

  /** What the caller is missing, said in terms of the domain rather than of a field name. */
  protected abstract get requires(): string;

  async ask(request: GroupRequest): Promise<DispatchResult> {
    const resolution = this.routingKeyFor(request.subject);
    if (!resolution) {
      return {
        provider: 'internal',
        arrangementId: '',
        status: 'error',
        latencyMs: 0,
        error: `${this.capability} could not be routed: ${this.requires}`,
      };
    }
    return dispatchToInstitution(
      this.db, this.capability, request.event, request.payload, resolution, request.businessContext,
    );
  }
}

/** A group where any active provider can answer and the routing strategy picks one. */
export abstract class StrategyBoundGroup extends CapabilityGroup {
  protected abstract readonly capability: StrategyBoundProviderType;

  async ask(request: GroupRequest): Promise<DispatchResult> {
    return dispatchByStrategy(this.db, this.capability, request.event, request.payload, request.businessContext);
  }
}

// ── The institution-bound groups ─────────────────────────────────────────────────────────────────

/**
 * Card validation and the protected values behind a card.
 *
 * Routed by the card, because only its issuer holds the number and only the issuer can derive the verification
 * value. A registered card names its issuer through its token; a card whose digits were just typed names it
 * through the leading digits, which is what the industry's issuer identification number is for.
 */
export class CardIssuerGroup extends InstitutionBoundGroup {
  protected readonly capability = 'card_issuer' as const;

  protected get requires(): string {
    return 'a card token, or the leading digits of a card number, is needed to identify the issuer';
  }

  protected routingKeyFor(subject: GroupRequest['subject']): ResolutionContext | null {
    if (subject?.cardToken) return { cardToken: subject.cardToken };
    if (subject?.cardNumberBin) return { cardNumberBin: subject.cardNumberBin };
    return null;
  }
}

/**
 * Whether a card transaction is authorised.
 *
 * The same routing key as validation, for a different reason: an authorisation is a HOLD against the funding
 * account, and only the institution holding it can place one.
 */
export class CardAuthorizationGroup extends InstitutionBoundGroup {
  protected readonly capability = 'card_authorization' as const;

  protected get requires(): string {
    return 'a card token is needed to identify the issuer that would place the hold';
  }

  protected routingKeyFor(subject: GroupRequest['subject']): ResolutionContext | null {
    return subject?.cardToken ? { cardToken: subject.cardToken } : null;
  }
}

/**
 * Reading an account: its status, its balance, whether an amount is available.
 *
 * Routed by the account. A linked account carries its institution on the record; a freshly entered IBAN names
 * its institution through the bank code inside it, which is the linking moment.
 */
export class AccountInformationGroup extends InstitutionBoundGroup {
  protected readonly capability = 'account_information' as const;

  protected get requires(): string {
    return 'an account reference, or an IBAN, is needed to identify the servicing institution';
  }

  protected routingKeyFor(subject: GroupRequest['subject']): ResolutionContext | null {
    if (subject?.accountReference) return { accountReference: subject.accountReference };
    if (subject?.iban) return { iban: subject.iban };
    return null;
  }
}

/**
 * Initiating a payment.
 *
 * Routed by the DEBTOR's account, never the creditor's. The payer's bank is the institution that executes the
 * debit; the recipient's bank is not one this provider has a relationship with and cannot reach. From the
 * creditor's IBAN the provider derives only the payment PRODUCT, which is a separate question.
 */
export class PaymentInitiationGroup extends InstitutionBoundGroup {
  protected readonly capability = 'payment_initiation' as const;

  protected get requires(): string {
    return "the payer's account reference is needed to identify the institution that executes the debit";
  }

  protected routingKeyFor(subject: GroupRequest['subject']): ResolutionContext | null {
    return subject?.accountReference ? { accountReference: subject.accountReference } : null;
  }
}

/** The institution holding the account, as distinct from reading it or initiating from it. */
export class AspspGroup extends InstitutionBoundGroup {
  protected readonly capability = 'aspsp' as const;

  protected get requires(): string {
    return 'an account reference, or an IBAN, is needed to identify the institution that holds it';
  }

  protected routingKeyFor(subject: GroupRequest['subject']): ResolutionContext | null {
    if (subject?.accountReference) return { accountReference: subject.accountReference };
    if (subject?.iban) return { iban: subject.iban };
    return null;
  }
}

// ── The strategy-bound groups ────────────────────────────────────────────────────────────────────

export class FraudDetectionGroup extends StrategyBoundGroup {
  protected readonly capability = 'fraud_detection' as const;
}

export class SanctionsGroup extends StrategyBoundGroup {
  protected readonly capability = 'hrp_sanctions' as const;
}

export class AmlMonitoringGroup extends StrategyBoundGroup {
  protected readonly capability = 'aml_monitoring' as const;
}

export class KycIdentityGroup extends StrategyBoundGroup {
  protected readonly capability = 'kyc_identity' as const;
}

export class KybBusinessGroup extends StrategyBoundGroup {
  protected readonly capability = 'kyb_business' as const;
}

export class CreditBureauGroup extends StrategyBoundGroup {
  protected readonly capability = 'credit_bureau' as const;
}

/**
 * Every group, by capability.
 *
 * Exhaustive over the institution-bound set on purpose: a capability added there without a group here is a
 * compile error, which is the point. The strategy-bound entries are the ones the reactors actually use; the
 * rest reach their providers through the same strategy door directly.
 */
export const INSTITUTION_BOUND_GROUPS: Record<
  EntityBoundProviderType,
  new (db: Db) => InstitutionBoundGroup
> = {
  card_issuer: CardIssuerGroup,
  card_authorization: CardAuthorizationGroup,
  account_information: AccountInformationGroup,
  payment_initiation: PaymentInitiationGroup,
  aspsp: AspspGroup,
};

/** The group serving a capability that must reach one specific institution. */
export function institutionGroupFor(db: Db, capability: EntityBoundProviderType): InstitutionBoundGroup {
  return new INSTITUTION_BOUND_GROUPS[capability](db);
}

import { Db } from 'mongodb';
import { EventBus, DomainEvent, makeEvent } from '../../vendors/eventbus';
import { dispatchProvider } from '../../modules/provider/services/integrationDispatch.service';
import { getChdCrypto } from '../../vendors/encryption/chdCrypto';
import { recordPendingCorrelation } from '../../modules/provider/services/pendingCorrelation.service';
import { publishIssuerValidationCompleted } from '../../modules/transaction/services/cardTransaction.service';
import { PAYMENT_CARD_COLLECTION } from '../../modules/customer/models/paymentCard.model';
import { PAYOUT_ACCOUNT_COLLECTION, PayoutAccountArrangement } from '../../modules/gateway/models/payoutAccount.model';
import { holdFundsAtBank, isBankLinked } from '../card-authorization/services/bankcoreCardAuthorisation.client';
import { config } from '../../config';
import { resolveAndConvert } from '../currency-exchange/services/currencyExchange.service';
import { applyKycScreeningVerdict } from '../../modules/customer/services/customerAgreement.service';
import { getCapabilityModuleConfig } from '../../modules/provider/services/capabilityModuleConfig.service';
import { effectiveDecisionMode, DecisionModeConfig } from '../../shared/models/onboardingDecision';
import type { HrpScreeningVerdict } from '../kyc/services/hrpScreening.service';
import {
  RESPONSE_CODE_APPROVED,
  RESPONSE_CODE_INSUFFICIENT_FUNDS,
  DECISION_REASON_INSUFFICIENT_FUNDS,
  DECISION_REASON_ACCOUNT_NOT_FOUND,
} from '../../shared/models/responseCodes';

// Card-transaction types that DEBIT the funding account and therefore require an atomic funds hold.
// Refunds/adjustments credit or are non-cash and pass the gate without a hold.
const FUNDS_DEBIT_TYPES = new Set(['purchase', 'cash_advance', 'fee']);

// Provider Group reactors: each subscribes to a provider category's `*.requested` event, performs the
// outbound call (the only place dispatchProvider runs for these flows), and publishes the matching
// `*.completed`. This makes the payment-authorization gates bus-driven: the orchestrator only emits
// requests; the actual provider call is a reaction to the bus. Card data (`chd`) is decrypted here,
// just-in-time, only by the card-issuer reactor; plaintext never returns to the bus.

const ISSUER_AAD_EVENT = 'card.issuer.validation.requested';

export class ProviderGroups {
  constructor(private readonly db: Db, private readonly bus: EventBus) {}

  register(): void {
    this.bus.subscribe('card.issuer.validation.requested', (e) => this.onIssuer(e));
    this.bus.subscribe('fds.scoring.requested', (e) => this.onFds(e));
    this.bus.subscribe('hrp.screening.requested', (e) => this.onHrp(e));
    // VOP is dispatched synchronously via dispatchProvider in the RTP screening flow (never emitted on
    // the bus), so there is intentionally NO 'vop.verification.requested' subscription here.
    this.bus.subscribe('funds.check.requested', (e) => this.onFunds(e));
    // v27 Phase 6: KYC/HRP customer screening (->). A customer profile validation
    // completing triggers a re-screen; the request event is a first-class Integration Hub gate.
    this.bus.subscribe('profile.validation.completed', (e) => this.onProfileValidated(e));
    this.bus.subscribe('kyc.screening.requested', (e) => this.onKycScreening(e));
    // v31 KYB onboarding chain (§5bis): bridge + entity screening reactors. Fan-out is events-only,
    // every provider is reached via dispatchProvider, so the built-in engine is swappable for an
    // external vendor with zero reactor change. correlationId = merchantAgreementInstanceReference.
    this.bus.subscribe('merchant.validation.requested', (e) => this.onMerchantValidated(e));
    this.bus.subscribe('kyb.screening.requested', (e) => this.onKybScreening(e));
    this.bus.subscribe('aml.screening.requested', (e) => this.onAml(e));
  }

  // Bridge (mirror of onProfileValidated): a merchant onboarding init fans out the KYB entity screening
  // (kyb_business + hrp_sanctions + aml_monitoring) AND one KYC screening per beneficial owner (owner
  // layer, reusing onKycScreening). All events carry the same correlationId (= merchantRef) so the whole
  // journey is reconstructable, and causationId = e.eventId preserves cause→effect.
  private async onMerchantValidated(e: DomainEvent): Promise<void> {
    const p = e.payload as { merchantAgreementInstanceReference?: string; merchantName?: string; merchantCategoryCode?: string; merchantCountryCode?: string };
    const merchantRef = p.merchantAgreementInstanceReference ?? e.correlationId;
    const pub = (eventType: string, payload: Record<string, unknown>, bian: { serviceDomain: string; controlRecord: string }) =>
      void this.bus.publish(makeEvent({ eventType, correlationId: e.correlationId, businessProcess: 'merchant_onboarding', source: 'psp.core', causationId: e.eventId, payload, bian }));

    pub('kyb.screening.requested', { merchantAgreementInstanceReference: merchantRef, merchantName: p.merchantName, merchantCategoryCode: p.merchantCategoryCode, merchantCountryCode: p.merchantCountryCode }, { serviceDomain: 'SD-89 Merchant Relations', controlRecord: 'MerchantAgreementProcedure' });
    // HRP screens the entity: pass the merchant reference via accountReference (the field onHrp forwards),
    // not a transaction id. correlationId already carries the merchant ref for the journey.
    pub('hrp.screening.requested', { accountReference: merchantRef, merchantName: p.merchantName }, { serviceDomain: 'SD-13 Party Reference', controlRecord: 'PartyReferenceDataDirectoryEntry' });
    pub('aml.screening.requested', { merchantAgreementInstanceReference: merchantRef, merchantCategoryCode: p.merchantCategoryCode }, { serviceDomain: 'SD-99 AML', controlRecord: 'SuspiciousActivityAnalysisAssessment' });

    // Owner layer: screen every beneficial owner (controlling person) by reusing the KYC chain.
    try {
      const merchant = await this.db.collection<{ merchantBeneficialOwners?: Array<{ merchantBeneficialOwnerPartyReference: string }>; merchantOwnerPartyReference?: string }>('merchantAgreementProcedure')
        .findOne({ merchantAgreementInstanceReference: merchantRef }, { projection: { merchantBeneficialOwners: 1, merchantOwnerPartyReference: 1 } });
      const ownerRefs = new Set<string>();
      for (const o of merchant?.merchantBeneficialOwners ?? []) ownerRefs.add(o.merchantBeneficialOwnerPartyReference);
      if (merchant?.merchantOwnerPartyReference) ownerRefs.add(merchant.merchantOwnerPartyReference);
      for (const ref of ownerRefs) {
        void this.bus.publish(makeEvent({
          eventType: 'kyc.screening.requested', correlationId: ref, businessProcess: 'customer_onboarding',
          source: 'psp.core', causationId: e.eventId, payload: { partyInstanceReference: ref },
          bian: { serviceDomain: 'SD-13 Party Data Management', controlRecord: 'PartyReferenceDataDirectoryEntry' },
        }));
      }
    } catch { /* owner screening is best-effort; entity chain still resolves */ }
  }

  // KYB entity screening reactor. Dispatches the kyb_business provider (internal engine loopback to
  // /modules/kyb/score, or an external vendor if configured), then publishes kyb.screening.completed.
  // Fail-open: a transport error yields a low-risk/clear default so onboarding is never hard-blocked.
  private async onKybScreening(e: DomainEvent): Promise<void> {
    const p = e.payload as { merchantAgreementInstanceReference?: string; merchantName?: string; merchantCategoryCode?: string; merchantCountryCode?: string };
    const merchantRef = p.merchantAgreementInstanceReference ?? e.correlationId;
    let businessRiskLevel: 'low' | 'medium' | 'high' = 'low';
    let sanctionsResult: 'clear' | 'hit' | 'pending' = 'clear';
    let verificationStatus: 'pass' | 'fail' | 'manual_review' = 'pass';
    let providerRef = 'kyb_business:internal';
    let outcome: 'completed' | 'error' = 'error';
    try {
      const r = await dispatchProvider(this.db, 'kyb_business', 'kyb.screening.requested', {
        merchantAgreementInstanceReference: merchantRef, clientReference: merchantRef,
        merchantName: p.merchantName, merchantCategoryCode: p.merchantCategoryCode, merchantCountryCode: p.merchantCountryCode,
      }, { entityType: 'merchant', entityId: merchantRef, processType: 'kyb_verification' });
      const b = r.responseBody as { verificationStatus?: 'pass' | 'fail' | 'manual_review'; businessRiskLevel?: 'low' | 'medium' | 'high'; sanctionsMatch?: boolean } | undefined;
      if (b) {
        businessRiskLevel = b.businessRiskLevel ?? 'low';
        sanctionsResult = b.sanctionsMatch ? 'hit' : 'clear';
        verificationStatus = b.verificationStatus ?? 'pass';
        const pr = (r as { providerReference?: string }).providerReference;
        if (pr) providerRef = pr;
        outcome = 'completed';
      }
    } catch { /* fail-open */ }
    void this.bus.publish(makeEvent({
      eventType: 'kyb.screening.completed', correlationId: e.correlationId, businessProcess: 'merchant_onboarding',
      source: 'callback.kyb', causationId: e.eventId,
      payload: { merchantAgreementInstanceReference: merchantRef, outcome, businessRiskLevel, sanctionsResult, verificationStatus, screeningProviderRef: providerRef },
      bian: { serviceDomain: 'SD-89 Merchant Relations', controlRecord: 'MerchantAgreementProcedure' },
    }));
  }

  // AML monitoring reactor (business AML / MCC / adverse media). Dispatches aml_monitoring, publishes
  // aml.screening.completed. Fail-open on transport error.
  private async onAml(e: DomainEvent): Promise<void> {
    const p = e.payload as { merchantAgreementInstanceReference?: string; merchantCategoryCode?: string };
    const merchantRef = p.merchantAgreementInstanceReference ?? e.correlationId;
    let adverseMediaResult: 'clear' | 'hit' | 'pending' = 'clear';
    let outcome: 'completed' | 'error' = 'error';
    try {
      const r = await dispatchProvider(this.db, 'aml_monitoring', 'aml.screening.requested', {
        merchantAgreementInstanceReference: merchantRef, clientReference: merchantRef, merchantCategoryCode: p.merchantCategoryCode,
      }, { entityType: 'merchant', entityId: merchantRef, processType: 'aml_screening' });
      const b = r.responseBody as { alertLevel?: string; requiresReview?: boolean } | undefined;
      if (b) {
        adverseMediaResult = b.alertLevel && b.alertLevel !== 'none' ? 'hit' : (b.requiresReview ? 'pending' : 'clear');
        outcome = 'completed';
      }
    } catch { /* fail-open */ }
    void this.bus.publish(makeEvent({
      eventType: 'aml.screening.completed', correlationId: e.correlationId, businessProcess: 'merchant_onboarding',
      source: 'callback.aml', causationId: e.eventId,
      payload: { merchantAgreementInstanceReference: merchantRef, outcome, adverseMediaResult },
      bian: { serviceDomain: 'SD-99 AML', controlRecord: 'SuspiciousActivityAnalysisAssessment' },
    }));
  }

  // Bridge: a completed customer-profile validation requests a KYC/HRP re-screen. Keeps the trigger
  // bus-driven (the onboarding service only emits its compliance milestone; screening is a reaction),
  // so updateSelfProfile stays untouched. correlationId = partyInstanceReference throughout.
  private onProfileValidated(e: DomainEvent): void {
    const p = e.payload as { entityType?: string };
    if (p.entityType && p.entityType !== 'customer') return;
    void this.bus.publish(makeEvent({
      eventType: 'kyc.screening.requested', correlationId: e.correlationId,
      businessProcess: 'customer_onboarding', source: 'psp.core', causationId: e.eventId,
      payload: { partyInstanceReference: e.correlationId },
      bian: { serviceDomain: 'SD-13 Party Data Management', controlRecord: 'PartyReferenceDataDirectoryEntry' },
    }));
  }

  // KYC/HRP screening reactor. Dispatches the screening provider through the Integration Hub
  // (kyc_identity capability, internal stub Module engine loopback), then persists the structured
  // verdict onto the KYC check sub-doc via the owning customer service (L2 QE write). Fail-open:
  // a transport error leaves the existing (seeded) verdicts in place.
  private async onKycScreening(e: DomainEvent): Promise<void> {
    const p = e.payload as { partyInstanceReference?: string };
    const partyRef = p.partyInstanceReference ?? e.correlationId;

    let verdict: HrpScreeningVerdict | undefined;
    try {
      const r = await dispatchProvider(this.db, 'kyc_identity', 'kyc.screening.requested', {
        partyInstanceReference: partyRef, clientReference: partyRef,
      }, { entityType: 'customer', entityId: partyRef, processType: 'kyc_verification' });
      verdict = r.responseBody as HrpScreeningVerdict | undefined;
    } catch { /* fail-open: leave existing verdicts */ }

    let outcome: 'completed' | 'error' = 'error';
    if (verdict && typeof verdict.riskScore === 'number') {
      // v31 §3.7/§4.0: resolve the KYC decisionMode (seeded automated) so applyKycScreeningVerdict sets
      // the BQ:Step status coherently. Unknown/unset → manual (fail-safe) via effectiveDecisionMode.
      const cfg = (await getCapabilityModuleConfig(this.db, 'kyc').catch(() => null))?.moduleConfig as DecisionModeConfig | undefined;
      const persisted = await applyKycScreeningVerdict(partyRef, verdict, effectiveDecisionMode(cfg)).catch(() => false);
      if (persisted) outcome = 'completed';
    }

    void this.bus.publish(makeEvent({
      eventType: 'kyc.screening.completed', correlationId: e.correlationId,
      businessProcess: 'customer_onboarding', source: 'callback.kyc', causationId: e.eventId,
      payload: {
        partyInstanceReference: partyRef, outcome,
        riskScore: verdict?.riskScore, riskRating: verdict?.riskRating, pepStatus: verdict?.pepStatus,
        sanctionsResult: verdict?.sanctionsResult, screeningProviderRef: verdict?.screeningProviderRef,
      },
      bian: { serviceDomain: 'SD-53 Customer Agreement', controlRecord: 'CustomerAgreementProcedure' },
    }));
  }

  // v17 funds-availability gate (AIS). Resolves the funding account from the card token, reads
  // the balance via the account_information capability (provider-indifferent: built-in module reads the
  // internal ledger, an external PSD2 AIS substitutes it), converts the amount to the account currency
  // (FX), and performs the ATOMIC hold. The hold ($gte-conditional $inc) is the authoritative decision:
  // no read-modify-write race. Insufficient funds → declined '51'. Non-debit types pass without a hold.
  private async onFunds(e: DomainEvent): Promise<void> {
    const p = e.payload as { cardToken?: string; amount?: number; currency?: string; cardTransactionType?: string };
    const txnId = e.correlationId;
    const amount = p.amount ?? 0;
    const txnCurrency = p.currency ?? 'EUR';

    const publish = (payload: Record<string, unknown>) => void this.bus.publish(makeEvent({
      eventType: 'funds.check.completed', correlationId: txnId, businessProcess: 'card_payment',
      source: 'callback.funds', causationId: e.eventId,
      payload: { transactionId: txnId, ...payload },
      bian: { serviceDomain: 'SD-36 Account Information', controlRecord: 'AccountInformationValidation' },
    }));

    // Non-debit types (refund/balance_transfer/adjustment) never hold funds: the gate approves.
    if (!p.cardTransactionType || !FUNDS_DEBIT_TYPES.has(p.cardTransactionType)) {
      publish({ outcome: 'approved', responseCode: RESPONSE_CODE_APPROVED });
      return;
    }

    // Resolve funding account from the card-on-file token. The internal funds gate ONLY governs cards
    // funded by a PSP-internal payout account (fundingPayoutAccountInstanceReference). A new/unsaved
    // token or an external card has no internal funding account: its funds are the ISSUER's
    // responsibility (the card.issuer gate), so this gate passes through (approve, no hold).
    const card = await this.db.collection<{ fundingPayoutAccountInstanceReference?: string }>(PAYMENT_CARD_COLLECTION)
      .findOne({ paymentCardReference: p.cardToken }, { projection: { fundingPayoutAccountInstanceReference: 1 } });
    const accountRef = card?.fundingPayoutAccountInstanceReference;
    if (!accountRef) {
      publish({ outcome: 'approved', responseCode: RESPONSE_CODE_APPROVED, decisionReason: 'no_internal_funding_account' });
      return;
    }

    const account = await this.db.collection<PayoutAccountArrangement>(PAYOUT_ACCOUNT_COLLECTION)
      .findOne({ payoutAccountInstanceReference: accountRef });
    if (!account || account.payoutAccountStatus !== 'active') {
      publish({ outcome: 'declined', responseCode: RESPONSE_CODE_INSUFFICIENT_FUNDS, decisionReason: DECISION_REASON_ACCOUNT_NOT_FOUND, fundingPayoutAccountReference: accountRef });
      return;
    }

    // FX: convert the transaction amount into the funding-account currency before holding.
    const accountCurrency = account.payoutAccountCurrency;
    let amountInAccountCcy = amount;
    let fxRate = 1;
    let converted = false;
    try {
      const fx = await resolveAndConvert(this.db, amount, txnCurrency, accountCurrency);
      amountInAccountCcy = fx.amount; fxRate = fx.rate; converted = fx.converted;
    } catch { /* missing rate: fall back to same-amount, no conversion (surfaced via converted=false) */ }

    // Provider-indifferent READ for audit/observability + external substitution (fail-open on error).
    void dispatchProvider(this.db, 'account_information', 'funds.check.requested', {
      payoutAccountInstanceReference: accountRef, clientReference: txnId, requestedFields: ['balance', 'status'],
    }, { entityType: 'transaction', entityId: txnId, processType: 'payment_processing' }).catch(() => {});

    const available = account.payoutAccountBalance?.availableAmount ?? 0;

    // The hold happens where the money is, and there is no longer an alternative (v37 P12).
    //
    // The PSP's stored balance is a PROJECTION of the bank's, so a local hold would decide on stale data and
    // mutate a figure that is not authoritative: correct-looking and wrong. It used to do exactly that
    // whenever the bank was disabled or the account was unlinked, which made the provider a place money was
    // held. An account this provider cannot reach at a bank is now REFUSED rather than decided locally,
    // because refusing is honest and holding funds it does not have is not.
    //
    // The branch is on whether the account is LINKED, never on which bank it is at, so a second registered
    // bank needs no change here.
    if (isBankLinked(account)) {
      const bankHold = await holdFundsAtBank({
        account, amount: amountInAccountCcy, currency: accountCurrency,
        cardToken: p.cardToken, transactionType: p.cardTransactionType, clientReference: txnId,
      });
      if (bankHold.error) {
        // FAIL CLOSED. A funds gate that fails open authorises a payment nobody checked, and the
        // authoritative balance is precisely what we could not reach.
        publish({
          outcome: 'declined', responseCode: RESPONSE_CODE_INSUFFICIENT_FUNDS,
          decisionReason: 'funding_bank_unreachable', available, currency: accountCurrency,
          fundingPayoutAccountReference: accountRef, converted, ...(converted ? { fxRate } : {}),
        });
        return;
      }
      if (!bankHold.approved) {
        publish({
          outcome: 'declined',
          // The issuer's own code, carried through rather than re-derived: it already means what it says.
          responseCode: bankHold.responseCode ?? RESPONSE_CODE_INSUFFICIENT_FUNDS,
          decisionReason: DECISION_REASON_INSUFFICIENT_FUNDS, available, currency: accountCurrency,
          fundingPayoutAccountReference: accountRef, converted, ...(converted ? { fxRate } : {}),
        });
        return;
      }
      publish({
        outcome: 'approved', responseCode: RESPONSE_CODE_APPROVED, available, held: amountInAccountCcy,
        currency: accountCurrency, fundingPayoutAccountReference: accountRef, converted,
        ...(converted ? { fxRate } : {}),
      });
      return;
    }

    // An account with no institution behind it. The provider holds no balance of its own, so there is nothing
    // here to authorise against: this FAILS CLOSED with the reason, rather than approving on a figure it
    // cannot stand behind.
    publish({
      outcome: 'declined',
      responseCode: RESPONSE_CODE_INSUFFICIENT_FUNDS,
      decisionReason: 'funding_account_not_linked_to_a_bank',
      available,
      currency: accountCurrency,
      fundingPayoutAccountReference: accountRef,
      converted,
      ...(converted ? { fxRate } : {}),
    });
  }

  // Real-time fraud scoring. A fraud signal never declines the payment: the authorization proceeds on
  // the issuer/funds verdicts and the risk verdict opens an investigation case instead (L1 -> L2).
  private async onFds(e: DomainEvent): Promise<void> {
    const p = e.payload as Record<string, unknown>;
    let reason: string | undefined;
    let verdict: { riskScore?: number; recommendation?: string; fraudFlag?: boolean; rulesFired?: string[] } | undefined;
    try {
      const r = await dispatchProvider(this.db, 'fraud_detection', 'fds.scoring.requested', {
        cardTransactionInstanceReference: e.correlationId, amount: p.amount, currency: p.currency,
        merchantName: p.merchantName, merchantCategoryCode: p.merchantCategoryCode,
      }, { entityType: 'transaction', entityId: e.correlationId, processType: 'fraud_evaluation' });
      verdict = r.responseBody as typeof verdict;
      if (verdict?.recommendation === 'block' || verdict?.recommendation === 'decline') reason = 'fraud_review';
    } catch { /* fail-open */ }
    void this.bus.publish(makeEvent({
      eventType: 'fds.scoring.completed', correlationId: e.correlationId, businessProcess: 'card_payment', source: 'callback.fds', causationId: e.eventId,
      payload: { transactionId: e.correlationId, outcome: 'approved', approved: true, reason, riskScore: verdict?.riskScore, recommendation: verdict?.recommendation, fraudFlag: verdict?.fraudFlag, rulesFired: verdict?.rulesFired },
      bian: { serviceDomain: 'SD-63 Fraud Evaluation', controlRecord: 'FraudEvaluationAssessment' },
    }));
  }

  // Sanctions/HRP screening. Fail-open on transport error. A match holds the payment for investigation
  // (funds frozen, nothing delivered) rather than declining it: the freeze obligation is met by never
  // completing the payment, and only an explicit L1/L2 resolution can release or reverse it.
  private async onHrp(e: DomainEvent): Promise<void> {
    const p = e.payload as Record<string, unknown>;
    let sanctionsMatch = false;
    let reason: string | undefined;
    try {
      const r = await dispatchProvider(this.db, 'hrp_sanctions', 'hrp.screening.requested', {
        cardTransactionInstanceReference: e.correlationId, accountReference: p.accountReference, merchantName: p.merchantName,
      }, { entityType: 'transaction', entityId: e.correlationId, processType: 'aml_screening' });
      const b = r.responseBody as { hrpcMatch?: boolean; match?: boolean } | undefined;
      if (b && (b.hrpcMatch ?? b.match)) { sanctionsMatch = true; reason = 'sanctions_review'; }
    } catch { /* fail-open */ }
    void this.bus.publish(makeEvent({
      eventType: 'hrp.screening.completed', correlationId: e.correlationId, businessProcess: 'card_payment', source: 'callback.hrp', causationId: e.eventId,
      payload: { transactionId: e.correlationId, outcome: 'approved', approved: true, sanctionsMatch, reason },
      bian: { serviceDomain: 'SD-13 Party Reference', controlRecord: 'PartyReferenceDataDirectoryEntry' },
    }));
  }

  // Card-issuer validation. Decrypts the `chd` carrier just-in-time for the wire; plaintext is never
  // re-published or logged. Fail-safe to approve on transport failure (only an explicit decline blocks).
  private async onIssuer(e: DomainEvent): Promise<void> {
    const p = e.payload as { cardToken?: string; maskedPan?: string; cardNetwork?: string; chd?: string; cvvExpected?: boolean };
    const txnId = e.correlationId;

    // Restore the journey envelope for a would-be async issuer callback (the sync built-in path
    // completes inline below).
    recordPendingCorrelation({ ref: txnId, correlationId: txnId, causationId: e.eventId, businessProcess: 'card_payment', eventType: 'card.issuer.validation.completed' });

    let cardData: { cardNumber?: string; cvv?: string; expiry?: string } = {};
    if (p.chd) {
      try { cardData = await getChdCrypto().decrypt(p.chd, { correlationId: txnId, eventType: ISSUER_AAD_EVENT }); }
      catch { /* tamper / AAD mismatch: send no CHD on the wire */ }
    }

    let decision: { actionConfirmed?: boolean; responseCode?: string; decisionReason?: string } | undefined;
    try {
      const r = await dispatchProvider(this.db, 'card_issuer', 'card.issuer.validation.requested', {
        cardToken: p.cardToken, maskedPan: p.maskedPan, cardTransactionInstanceReference: txnId,
        ...(p.cardNetwork ? { network: p.cardNetwork } : {}),
        ...(cardData.cardNumber ? { cardNumber: cardData.cardNumber } : {}),
        ...(cardData.cvv ? { cvv: cardData.cvv } : {}),
        ...(cardData.expiry ? { expiry: cardData.expiry } : {}),
        ...(p.cvvExpected ? { cvvExpected: true } : {}),
      }, { entityType: 'transaction', entityId: txnId, processType: 'payment_processing' });
      decision = r.responseBody as typeof decision;
    } catch { /* fail-safe to approve */ }

    publishIssuerValidationCompleted(txnId, {
      approved: decision?.actionConfirmed !== false,
      responseCode: decision?.responseCode,
      decisionReason: decision?.decisionReason,
    }, e.eventId);
  }
}

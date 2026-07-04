// Provider wire contracts (architecture §7.7) — the HTTP contract between a Provider Group adapter
// and its external vendor, OUTSIDE the bus. Distinct from the bus payloads: these carry the resolved
// data. The adapter is the only bridge (outbound: resolve refs + decrypt chd; inbound: verdict only).
import type {
  CardIssuerValidationCompleted,
  FdsScoringCompleted,
  HrpScreeningCompleted,
} from './cardPayment.events';
import type { AmlMonitoringCompleted } from './fraudInvestigation.events';

/**
 * Universal mixin: present on EVERY outbound request and echoed on EVERY callback.
 * clientReference = correlationId — the wire's only journey link (the vendor has no envelope).
 */
export interface WireCorrelation {
  clientReference: string;                  // = correlationId (e.g. cardTransactionInstanceReference)
}

/**
 * @event    card.issuer.validation.requested  @type outbound
 * @note     TLS only; CHD decrypted from `chd` and sent ONLY here, never persisted.
 */
export interface CardIssuerValidationOutbound extends WireCorrelation {
  amount: number;
  currency: string;
  cardNetwork?: string;
  cardNumber: string;                       // PAN — plaintext only on this wire
  cvv: string;
  expiry: string;                           // MM/YY
}

/**
 * @event    card.issuer.validation.completed  @type inbound
 * @note     Reuses the bus verdict; the adapter adds context (cardToken) and restores the envelope.
 */
export type CardIssuerValidationInbound = WireCorrelation &
  Pick<CardIssuerValidationCompleted, 'outcome' | 'responseCode' | 'decisionReason'>;

/**
 * @event    fds.scoring.requested  @type outbound
 * @note     Assembled by the adapter from stored transaction/party/device records — no CHD.
 */
export interface FdsScoringOutbound extends WireCorrelation {
  amount: number; currency: string; channel: string;
  merchantName: string; merchantCategoryCode?: string; merchantCountry?: string;
  accountAgeDays?: number; isNewPaymentMethod?: boolean;
  cardBin?: string; cardNetwork?: string; cardCountry?: string;   // non-CHD card context
  ipAddress?: string; deviceFingerprint?: string; userAgent?: string;   // device/network (PII-class)
  geoLocation?: { country?: string; city?: string; lat?: number; lon?: number };
  recentTransactionCount24h?: number; billingShippingMismatch?: boolean;
  threeDsResult?: 'authenticated' | 'attempted' | 'failed' | 'not_enrolled';
}

/**
 * @event    fds.scoring.completed  @type inbound
 */
export type FdsScoringInbound = WireCorrelation &
  Pick<FdsScoringCompleted, 'outcome' | 'riskScore' | 'recommendation' | 'riskFactors'>;

/**
 * @event    hrp.screening.requested  @type outbound
 * @note     Identity resolved from the QE party store via subjectPartyReference (§7.9).
 */
export interface HrpScreeningOutbound extends WireCorrelation {
  subject: { fullName: string; dateOfBirth?: string; nationality?: string;
             country?: string; documentNumber?: string; entityType?: 'individual' | 'business' };
  counterparty?: { fullName?: string; country?: string };
  context?: { amount?: number; currency?: string; merchantName?: string };
}

/**
 * @event    hrp.screening.completed  @type inbound
 * @note     Vendor outcome is clear|match; the adapter maps it to approved|declined on the bus.
 */
export interface HrpScreeningInbound extends WireCorrelation,
  Pick<HrpScreeningCompleted, 'matchType' | 'matchScore' | 'matchedList'> {
  outcome: 'clear' | 'match';
  matchedName?: string;                     // wire-only watchlist detail
}

/**
 * @event    aml.monitoring.requested  @type outbound
 * @note     Monitoring signal set assembled from the transaction + account history.
 */
export interface AmlMonitoringOutbound extends WireCorrelation {
  amount: number; currency: string; channel?: string;
  transactionType?: 'purchase' | 'transfer' | 'withdrawal' | 'refund';
  originAccountRef?: string;
  counterparty?: { name?: string; accountRef?: string; country?: string };
  destinationCountry?: string;
  account30dVolume?: number; account30dCount?: number;
  structuringIndicator?: boolean;           // many sub-threshold txns
  rapidMovementIndicator?: boolean;         // funds in and out quickly
  highRiskCorridor?: boolean;
}

/**
 * @event    aml.monitoring.completed  @type inbound
 * @note     Verdict shape equals the bus completed; only clientReference is added on the wire.
 */
export type AmlMonitoringInbound = WireCorrelation & AmlMonitoringCompleted;

// ── v17: Account Information Service (SD-36 AIS) wire contracts ──────────────

/**
 * @event    ais.account.validation.requested  @type outbound
 * @note     Carries only the PSP-internal payoutAccountInstanceReference.
 *           The wire adapter resolves the actual IBAN from the QE L2 vault BEFORE
 *           sending — IBAN never travels on the bus and never appears in logs.
 */
export interface AisValidationOutbound extends WireCorrelation {
  payoutAccountInstanceReference: string;  // PSP reference — adapter resolves IBAN via L2 vault
  accountCountryCode: string;              // ISO 3166-1 alpha-2
  accountCurrency: string;                 // ISO 4217
  requestedFields: ('balance' | 'identity' | 'status')[];
  consentReference?: string;              // FK → consentAgreement (required for real PSD2 AIS)
}

/**
 * @event    ais.account.validation.completed  @type inbound
 */
export interface AisValidationInbound extends WireCorrelation {
  accountVerified: boolean;
  accountStatus: 'active' | 'dormant' | 'closed' | 'unknown';
  identityMatch?: 'full' | 'partial' | 'failed' | 'not_checked';
  balancePending?: number;
  balanceAvailable?: number;
  currency?: string;
  providerReference?: string;
}

// ── v17: Payment Initiation (SD-66 PISP) wire contracts ──────────────────────

/**
 * @event    payment.initiation.requested  @type outbound
 * @note     payoutAccountInstanceReference is the PSP-opaque ref.
 *           Adapter resolves IBAN from L2 vault before sending on TLS wire only.
 */
export interface PaymentInitiationOutbound extends WireCorrelation {
  payoutAccountInstanceReference: string;  // PSP ref — adapter resolves IBAN via L2 vault
  railType: 'sepa' | 'ach' | 'swift' | 'local_bank' | 'internal_ledger';
  amount: number;
  currency: string;
  settlementSchedule: 'T+0' | 'T+1' | 'T+2' | 'T+3';
  paymentReference: string;               // for bank statement narrative
  debtorReference?: string;
}

/**
 * @event    payment.initiation.completed  @type inbound
 * @note     Async: status='submitted' arrives immediately; 'settled'/'failed' arrive later.
 */
export interface PaymentInitiationInbound extends WireCorrelation {
  railRef: string;
  status: 'submitted' | 'settled' | 'failed';
  completedAt?: string;                   // ISO 8601 — present on settled / failed
  errorCode?: string;
  errorReason?: string;
}

/**
 * Short-lived dispatch-time entry that lets an async callback restore the full envelope (§7.7).
 * Indexed by `ref` (clientReference / vendor ack), never by a URL token.
 */
export interface PendingCorrelation {
  ref: string;              // clientReference (= correlationId) or the vendor's own ref from the ACK
  correlationId: string;    // the journey — restores the envelope correlationId
  causationId: string;      // eventId of the originating *.requested — restores cause->effect
  businessProcess: string;  // restores the envelope businessProcess (also derivable from eventType)
  eventType: string;        // the *.completed to publish, e.g. "card.issuer.validation.completed"
  expiresAt: string;        // if it lapses with no callback -> the saga times out (fail-open per gate)
}

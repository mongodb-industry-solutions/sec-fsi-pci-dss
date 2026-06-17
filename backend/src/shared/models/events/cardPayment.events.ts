// Bus payload contracts for the `card_payment` process (architecture §7.1).
// Reference-led, no raw cardholder data — CHD rides only in the encrypted `chd` envelope (§7.8).
// correlationId = transactionId for every event in this process.

/**
 * @event    card.payment.authorization.requested
 * @producer psp.core  @consumer PaymentAuthorizationSaga
 */
export interface CardPaymentAuthorizationRequested {
  amount: number;
  currency: string;                         // ISO-4217
  channel: 'api' | 'checkout' | 'payment_link';
  merchantName: string;
  merchantCategoryCode?: string;
  maskedPan: string;                        // "411111******1111" — masked only
  cardNetwork?: string;
  cardToken?: string;                       // tokenized card-on-file reference
  accountReference?: string;
  gatesExpected: Array<'card.issuer' | 'fds' | 'hrp'>;
}

/**
 * @event    card.issuer.validation.requested
 * @producer psp.core  @consumer Card Issuer provider group
 * @note     CHD rides ONLY in encrypted `chd`; persisted temporarily + purged (§7 intro, §7.8).
 */
export interface CardIssuerValidationRequested {
  cardToken: string;                        // tokenized card-on-file reference — NOT the PAN
  maskedPan: string;
  cardNetwork?: string;
  amount: number;
  currency: string;
  chd: string;                              // application-encrypted CHD envelope (opaque); purged after journey
}

/**
 * @event    card.issuer.validation.completed
 * @producer callback.card-issuer  @consumer PaymentAuthorizationSaga
 */
export interface CardIssuerValidationCompleted {
  cardToken: string;                        // which card was validated (token, never the PAN)
  outcome: 'approved' | 'declined';
  responseCode?: string;                    // ISO-8583-style: "00", "05", "51"
  decisionReason?: string;                  // "cvv_mismatch" | "expired_card" | "insufficient_funds"
  cvvProvided?: boolean;                    // audit signal only — never the CVV value
  cardNetwork?: string;
}

/**
 * @event    fds.scoring.requested
 * @producer psp.core  @consumer Fraud Detection (FDS) provider group
 * @note     Reference-led; the FDS adapter assembles FdsScoringOutbound (§7.7) JIT from these refs.
 */
export interface FdsScoringRequested {
  accountReference?: string;                // -> resolve account history / velocity / device-IP
  cardToken?: string;                       // -> resolve card-on-file (BIN, network, country)
  amount: number;                           // non-sensitive routing/threshold context
  currency: string;
  channel: 'api' | 'checkout' | 'payment_link';
  merchantName: string;
  merchantCategoryCode?: string;
}

/**
 * @event    fds.scoring.completed
 * @producer callback.fds  @consumer PaymentAuthorizationSaga
 */
export interface FdsScoringCompleted {
  outcome: 'approved' | 'declined';         // declined = block
  riskScore?: number;                       // 0..100
  recommendation?: 'approve' | 'review' | 'block';
  riskFactors?: string[];                   // e.g. ["new_device","geo_mismatch"] — feeds the case
  reason?: string;
}

/**
 * @event    hrp.screening.requested
 * @producer psp.core  @consumer HRP / Sanctions provider group
 * @note     No PII in clear: pass references; the HRP adapter resolves identity JIT (§7.7/§7.9).
 */
export interface HrpScreeningRequested {
  subjectPartyReference?: string;           // the account holder / payer
  counterpartyReference?: string;           // merchant / beneficiary, if applicable
  accountReference?: string;
  amount?: number;
  currency?: string;
  merchantName?: string;
  merchantCountry?: string;                 // ISO-3166
}

/**
 * @event    hrp.screening.completed
 * @producer callback.hrp  @consumer PaymentAuthorizationSaga
 */
export interface HrpScreeningCompleted {
  outcome: 'approved' | 'declined';         // declined = sanctions/PEP match -> hard stop
  matchType?: 'sanctions' | 'pep' | 'adverse_media';
  matchScore?: number;                      // 0..100 confidence of the watchlist match
  matchedList?: string;                     // e.g. "OFAC SDN" | "EU consolidated" — feeds the case
  reason?: string;
}

/**
 * @event    card.payment.authorization.completed
 * @producer saga.payment-authorization  @consumer psp.core (SSE + merchant callback), PostAuthorizationProcess
 */
export interface CardPaymentAuthorizationCompleted {
  outcome: 'authorized' | 'declined';
  responseCode?: string;
  decisionReason?: string;                  // set on decline, e.g. "sanctions_match"
  declinedBy?: 'card.issuer' | 'fds' | 'hrp';
  settledAmount?: { amount: number; currency: string };
  fraudCaseCreated: boolean;
  fraudDiagnosisInstanceReference?: string; // the case to enrich in Phase 2
}

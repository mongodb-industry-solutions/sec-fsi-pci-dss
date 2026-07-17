// Bus payload contracts for `customer_onboarding` (KYC, §7.4) and `merchant_onboarding` (KYB, §7.5).
// correlationId = customerReference (KYC) / merchantReference (KYB). Metadata only — never PII/images.

// ── customer_onboarding (KYC) ────────────────────────────────────────────────

/**
 * @event    profile.validation.requested
 * @producer psp.core  @consumer Customer Onboarding Process
 */
export interface ProfileValidationRequested {
  partyName?: string;
  country?: string;                         // ISO-3166
  documentType?: string;                    // metadata only — never document images/PII
}

/**
 * @event    kyc.validation.requested
 * @producer psp.core  @consumer KYC Provider
 */
export interface KycValidationRequested {
  partyName?: string;
  country?: string;
}

/**
 * @event    kyc.validation.completed
 * @producer callback.kyc  @consumer Customer Onboarding Process
 */
export interface KycValidationCompleted {
  outcome: 'verified' | 'rejected' | 'review';
  riskRating?: 'low' | 'medium' | 'high';
  reason?: string;
}

/**
 * @event    profile.validation.completed
 * @producer psp.core (Customer Onboarding Process)  @consumer Onboarding UI, notifications
 */
export interface ProfileValidationCompleted {
  outcome: 'verified' | 'rejected' | 'review';
  reason?: string;
}

/**
 * @event    kyc.screening.requested
 * @producer psp.core (bridge from profile.validation.completed)  @consumer HRP Screening Provider
 * v27: high-risk-party screening for a customer, dispatched through the Integration Hub (SD-193).
 */
export interface KycScreeningRequested {
  partyInstanceReference: string;
}

/**
 * @event    kyc.screening.completed
 * @producer callback.kyc  @consumer Onboarding UI, compliance/audit
 * Carries the provider-produced KYC verdict persisted on customerAgreementKycCheck.
 */
export interface KycScreeningCompleted {
  partyInstanceReference: string;
  outcome: 'completed' | 'error';
  riskScore?: number;
  riskRating?: 'low' | 'medium' | 'high';
  pepStatus?: boolean;
  sanctionsResult?: 'clear' | 'hit' | 'pending';
  screeningProviderRef?: string;
}

// ── merchant_onboarding (KYB) ─────────────────────────────────────────────────

/**
 * @event    merchant.validation.requested
 * @producer psp.core  @consumer Merchant Onboarding Process
 */
export interface MerchantValidationRequested {
  legalName?: string;
  country?: string;
  category?: string;                        // MCC
}

/**
 * @event    kyb.validation.requested
 * @producer psp.core  @consumer KYB Provider
 */
export interface KybValidationRequested {
  legalName?: string;
  country?: string;
}

/**
 * @event    kyb.validation.completed
 * @producer callback.kyb  @consumer Merchant Onboarding Process
 */
export interface KybValidationCompleted {
  outcome: 'verified' | 'rejected' | 'review';
  riskRating?: 'low' | 'medium' | 'high';
  reason?: string;
}

/**
 * @event    merchant.validation.completed
 * @producer psp.core (Merchant Onboarding Process)  @consumer Onboarding UI, notifications
 */
export interface MerchantValidationCompleted {
  outcome: 'verified' | 'rejected' | 'review';
  reason?: string;
}

'use client';
import { createContext, useContext, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Shared types + context for the merchant panel (/system/merchant nested routes).
// The layout loads the caller's merchant once and exposes it here; section pages
// (overview, checkout, links, payments, api-keys, webhooks) consume it.

export type KybCheckStatus = 'initiated' | 'verified' | 'rejected' | 'expired';

export interface MerchantAgreementKybCheck {
  merchantAgreementKybCheckStatus: KybCheckStatus;
  merchantAgreementKybCheckCompletedDate?: string;
  merchantAgreementKybCheckReference?: string;
  merchantAgreementKybCheckNotes?: string;
  merchantAgreementKybCheckPerformedByPartyReference?: string;
}

export interface MerchantRecord {
  merchantAgreementInstanceReference: string;
  merchantName: string;
  merchantCategoryCode: string;
  merchantCountryCode: string;
  merchantAgreementStatus: string;
  merchantWebhookEndpoint?: string;
  merchantRiskCategory?: string;
  merchantTier?: string;
  merchantAllowedCurrencies?: string[];
  merchantTransactionLimitAmount?: number;
  merchantSettlementSchedule?: string;
  merchantReviewNote?: string;
  merchantAgreementKybCheck?: MerchantAgreementKybCheck;
  recordCreatedDateTime?: string;
}

export type MerchantPanelState =
  | 'loading' | 'no_merchant' | 'under_review' | 'rejected' | 'agreed' | 'active' | 'analyst_list';

export interface MerchantContextValue {
  token: string;
  role: string;
  state: MerchantPanelState;
  merchant: MerchantRecord | null;
  refresh: () => void;
}

export const MerchantContext = createContext<MerchantContextValue | null>(null);

export function useMerchant(): MerchantContextValue {
  const ctx = useContext(MerchantContext);
  if (!ctx) throw new Error('useMerchant must be used within the /system/merchant layout');
  return ctx;
}

/** True when the caller is a customer who owns an operational merchant (sections apply). */
export function isActiveOwner(ctx: MerchantContextValue): boolean {
  return ctx.role === 'customer' && (ctx.state === 'active' || ctx.state === 'agreed') && !!ctx.merchant;
}

/**
 * Section pages call this: returns the context, and redirects non-owners (or
 * onboarding states) back to /system/merchant once loading resolves.
 */
export function useRequireActiveMerchant(): MerchantContextValue {
  const ctx = useMerchant();
  const router = useRouter();
  useEffect(() => {
    if (ctx.state !== 'loading' && !isActiveOwner(ctx)) {
      router.replace('/system/merchant');
    }
  }, [ctx, router]);
  return ctx;
}

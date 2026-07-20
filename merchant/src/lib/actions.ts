'use server';
// Server actions — the only place pages trigger PSP writes. Secrets stay server-side.
import { randomUUID } from 'crypto';
import { PspClient, PspError } from './PspClient';
import { ENV } from './env';
import { findProduct } from '@/config/products';

export interface ActionResult {
  ok: boolean;
  message?: string;
  /** For redirect-based methods: URL to send the buyer to. */
  redirectUrl?: string;
  /** For payment-link method: shareable link. */
  paymentUrl?: string;
  /** For payment-link method: short human-readable code for the link. */
  linkCode?: string;
  /** Primary reference to surface (order ref / payment link ref). */
  reference?: string;
  /** Card/payment transaction id, when the PSP returns one (API payment). */
  transactionRef?: string;
  /** PSP status string (e.g. "authorized"), for the confirmation chip. */
  status?: string;
  data?: unknown;
}

async function client(): Promise<PspClient> {
  // Server-action context: cookie writes are legal here, so use the mutating client
  // which may persist a rotated refresh token.
  const c = await PspClient.fromSessionForMutation();
  if (!c) throw new PspError(401, null, 'not authenticated');
  return c;
}

function toResult(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  return fn().catch((e) => {
    if (e instanceof PspError) {
      return { ok: false, message: e.isAuth ? 'Not authorised (scope not granted or session expired).' : `PSP error ${e.status}` };
    }
    return { ok: false, message: (e as Error).message ?? 'Unexpected error' };
  });
}

// ── Product checkout — dispatches by payment method ─────────────────────────────
export async function payForProduct(productId: string): Promise<ActionResult> {
  return toResult(async () => {
    const product = findProduct(productId);
    if (!product) return { ok: false, message: 'Unknown product' };
    const merchantRef = ENV.merchantAgreementRef();

    switch (product.method) {
      case 'payment_link': {
        const link = await PspClient.createPaymentLink({
          merchantAgreementInstanceReference: merchantRef,
          amount: product.price,
          currency: product.currency,
          description: product.name,
        });
        return {
          ok: true,
          paymentUrl: link.paymentUrl,
          linkCode: link.paymentLinkCode,
          reference: link.paymentLinkInstanceReference,
          message: 'Payment link created. Share it with the buyer to complete payment.',
        };
      }
      case 'redirect':
      case 'subscription': {
        const base = ENV.baseUrl();
        const session = await PspClient.createCheckoutSession({
          merchantAgreementInstanceReference: merchantRef,
          amount: product.price,
          currency: product.currency,
          description: product.name + (product.method === 'subscription' ? ' (subscription)' : ''),
          returnUrl: `${base}/history`,
          cancelUrl: `${base}/products`,
          merchantReference: `${product.id}-${Date.now()}`,
        });
        return { ok: true, redirectUrl: session.paymentPageUrl, message: 'Redirecting to secure checkout…' };
      }
      case 'api_payment': {
        // Server-to-server charge: the merchant's OWN client_credentials token (write:payments), NOT the
        // user session token. No CHD in the merchant; the PSP charges a tokenised card. We forward the
        // acting user's OAuth subject (from the session) purely for ATTRIBUTION so the charge is traceable
        // to the buyer (payment history + operations view) — the charge itself stays merchant-authenticated.
        const c = await client();
        const order = await PspClient.apiPaymentServerToServer(
          {
            paymentOrderMerchantReference: `${product.id}-${Date.now()}`,
            amount: product.price,
            currency: product.currency,
            paymentOrderDescription: product.name,
            actingSubjectReference: c.sub,
          },
          randomUUID(),
        );
        return {
          ok: true,
          reference: order.paymentOrderReference,
          transactionRef: order.cardTransactionInstanceReference,
          status: order.paymentOrderStatus,
          message: 'Payment charged successfully.',
          data: order,
        };
      }
      default:
        return { ok: false, message: 'Unsupported method' };
    }
  });
}

// ── Beneficiary direct pay ──────────────────────────────────────────────────────
export async function previewTransfer(input: {
  amount: number;
  currency: string;
  countryCode: string;
  iban?: string;
  accountNumber?: string;
  routingNumber?: string;
  bic?: string;
  beneficiaryName?: string;
  rail?: string;
  fromAccountRef?: string; // accepted for form-payload reuse; preview has no side effects and ignores it
}): Promise<ActionResult> {
  return toResult(async () => {
    const c = await client();
    const data = await c.previewTransfer({
      destination: {
        countryCode: input.countryCode,
        currency: input.currency,
        iban: input.iban,
        accountNumber: input.accountNumber,
        routingNumber: input.routingNumber,
        bic: input.bic,
        beneficiaryName: input.beneficiaryName,
      },
      amountCurrency: { amount: input.amount, currency: input.currency },
      rail: input.rail,
    });
    return { ok: true, data };
  });
}

// Add (register) a beneficiary via the PSP (SD-54). The merchant sends only a phone/email + optional
// label; the PSP resolves it to an opaque token (never revealing the recipient's identity). The PSP
// is anti-enumeration: it returns { found: false } for a non-existent OR already-saved contact, so we
// surface a neutral message either way.
export async function addBeneficiary(input: {
  lookupType: 'phone' | 'email';
  lookupValue: string;
  label?: string;
}): Promise<ActionResult> {
  return toResult(async () => {
    const value = input.lookupValue?.trim();
    if (!value) return { ok: false, message: 'Enter a phone number or email.' };
    const c = await client();
    const data = await c.addBeneficiary(input.lookupType, value, input.label?.trim() || undefined);
    if (!data.found) {
      return { ok: false, message: 'No matching Securit4 Pay user was found (or they are already saved).' };
    }
    return {
      ok: true,
      data,
      message: `Beneficiary added${data.counterpartyLabel ? `: ${data.counterpartyLabel}` : ''}.`,
    };
  });
}

// Remove (soft-delete) a saved beneficiary via the PSP (SD-54). The merchant sends only the opaque
// arrangement reference; the PSP scopes the delete to the acting user (token.sub). The arrangement is
// soft-deleted server-side and can be re-added later (which reactivates it).
export async function removeBeneficiary(input: { beneficiaryToken: string }): Promise<ActionResult> {
  return toResult(async () => {
    if (!input.beneficiaryToken) return { ok: false, message: 'Missing beneficiary reference.' };
    const c = await client();
    await c.removeBeneficiary(input.beneficiaryToken);
    return { ok: true, message: 'Beneficiary removed.' };
  });
}

// Send money to a saved beneficiary (P2P, SD-65). The merchant supplies only the beneficiary
// token + amount; the PSP resolves the source account and recipient server-side (no CHD/IBAN).
export async function sendToBeneficiary(input: {
  beneficiaryToken: string;
  amount: number;
  currency?: string;
  fromAccountRef?: string;
  note?: string;
}): Promise<ActionResult> {
  return toResult(async () => {
    if (!(input.amount > 0)) return { ok: false, message: 'Amount must be greater than zero.' };
    const c = await client();
    const data = await c.sendToBeneficiary(input.beneficiaryToken, input.amount, input.currency, input.fromAccountRef, input.note);
    if (data.status === 'failed') {
      return { ok: false, message: data.failureReason ?? 'Transfer failed.', data };
    }
    return {
      ok: true,
      data,
      message: `Sent ${data.amount} ${data.currency}. Reference ${data.transferReference} (${data.status}).`,
    };
  });
}

export async function bankTransfer(input: {
  amount: number;
  currency: string;
  countryCode: string;
  iban?: string;
  accountNumber?: string;
  routingNumber?: string;
  bic?: string;
  beneficiaryName?: string;
  rail?: string;
  reference?: string;
  fromAccountRef?: string;
}): Promise<ActionResult> {
  return toResult(async () => {
    const c = await client();
    const data = await c.bankTransfer({
      amount: input.amount,
      currency: input.currency,
      destination: {
        countryCode: input.countryCode,
        currency: input.currency,
        iban: input.iban,
        accountNumber: input.accountNumber,
        routingNumber: input.routingNumber,
        bic: input.bic,
        beneficiaryName: input.beneficiaryName,
      },
      rail: input.rail,
      reference: input.reference,
      fromAccountRef: input.fromAccountRef,
    });
    return { ok: true, data, message: 'Transfer submitted.' };
  });
}

// ── Request to Pay (RTP) — merchant requests / approves money (v28) ─────────────
export async function requestMoney(input: { amount: number; currency?: string; purpose?: string; payerPartyReference?: string; payerCounterpartyReference?: string }): Promise<ActionResult> {
  return toResult(async () => {
    const c = await client();
    if (!(input.amount > 0)) return { ok: false, message: 'Amount must be greater than zero.' };
    const req = await c.createRtpRequest(input);
    let paymentUrl: string | undefined;
    try { paymentUrl = (await c.getRtpQr(req.paymentRequestInstanceReference)).encodedPayload; } catch { /* optional */ }
    return { ok: true, reference: req.paymentRequestInstanceReference, status: req.status, paymentUrl, data: req };
  });
}

export async function approveRtp(ref: string, fundingAccountRef?: string): Promise<ActionResult> {
  return toResult(async () => {
    const c = await client();
    const res = await c.approveRtpRequest(ref, fundingAccountRef);
    return { ok: res.status === 'accepted', message: res.reason, status: res.status, reference: res.executionReference, data: res };
  });
}

export async function rejectRtp(ref: string): Promise<ActionResult> {
  return toResult(async () => { await (await client()).rejectRtpRequest(ref); return { ok: true, reference: ref }; });
}

export async function cancelRtp(ref: string): Promise<ActionResult> {
  return toResult(async () => { await (await client()).cancelRtpRequest(ref); return { ok: true, reference: ref }; });
}

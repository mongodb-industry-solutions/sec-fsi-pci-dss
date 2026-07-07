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
  data?: unknown;
}

async function client(): Promise<PspClient> {
  const c = await PspClient.fromSession();
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
    const c = await client();
    const merchantRef = ENV.merchantAgreementRef();

    switch (product.method) {
      case 'payment_link': {
        const link = await c.createPaymentLink({
          merchantAgreementInstanceReference: merchantRef,
          amount: product.price,
          currency: product.currency,
          description: product.name,
        });
        return { ok: true, paymentUrl: link.paymentUrl, message: 'Payment link created. Share it with the buyer.' };
      }
      case 'redirect':
      case 'subscription': {
        const base = ENV.baseUrl();
        const session = await c.createCheckoutSession({
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
        return { ok: true, message: `API payment charged: ${order.paymentOrderReference} (status ${order.paymentOrderStatus}).`, data: order };
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
    });
    return { ok: true, data, message: 'Transfer submitted.' };
  });
}

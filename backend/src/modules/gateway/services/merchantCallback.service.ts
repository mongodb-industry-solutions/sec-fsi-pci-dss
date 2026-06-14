// Merchant payment callback (PSP → merchant) — shared by the checkout (redirect), payment-link and
// direct (api-card / simulator) flows. Lives in its own module so the transactions service can fire
// it without creating an import cycle with checkout.service.
//
// THREE complementary effects, on BOTH approval and decline (PCI DSS Req 3: surrogate token + masked
// PAN only, NEVER PAN/CVV):
//   1. The merchant's OWN webhook (per-merchant `merchantWebhookEndpoint`, HMAC-signed with
//      `merchantWebhookSecret`) — the real callback to the correct merchant. Carries the transaction id.
//   2. A businessProcessEvent `payment.callback` (entityType=transaction) so the outcome is visible
//      and searchable in the unified audit (`/system/audit-events`) for manager/auditor — not just
//      `transaction.authorized`.
//   3. An Integration-Hub `generic` event as the inbound/outbound audit record (ADR-010/025).
import { Db } from 'mongodb';
import { deliverWebhook, type WebhookDeliveryResult } from './webhook.service';
import { MERCHANT_AGREEMENT_COLLECTION, MerchantAgreementControlRecord } from '../models/merchantAgreement.model';
import { dispatchIntegration } from '../../integrations/services/integrationDispatch.service';
import { emitProcessEvent } from '../../integrations/services/businessProcessEvent.service';

// Human-readable decline reasons keyed by the PSP/issuer response code (BIAN SD-15).
export const DECLINE_REASONS: Record<string, string> = {
  '0190': 'Authorization declined by the issuer',
  '0540': 'Card deactivated or removed by the cardholder',
};

export interface MerchantPaymentCallbackInput {
  merchantAgreementInstanceReference: string;
  amount: number;
  currency: string;
  merchantReference: string;
  // The originating context reference (checkout session, payment link, or transaction), for correlation.
  contextRef: string;
  contextType: 'checkout_session' | 'payment_link' | 'transaction';
  triggeredBy: string;
  result: 'approved' | 'declined';
  cardToken: string;
  maskedPan: string;
  responseCode: string;
  authorizationCode?: string;
  declineReason?: string;
  cardTransactionInstanceReference?: string;
}

export async function sendMerchantPaymentCallback(db: Db, o: MerchantPaymentCallbackInput): Promise<void> {
  const transactionId = o.cardTransactionInstanceReference ?? null;
  const payload: Record<string, unknown> = {
    event: o.result === 'approved' ? 'payment.completed' : 'payment.declined',
    result: o.result,
    cardToken: o.cardToken,                 // surrogate, NOT CHD
    maskedPan: o.maskedPan,                 // display-safe last 4
    responseCode: o.responseCode,
    ...(o.authorizationCode ? { authorizationCode: o.authorizationCode } : {}),
    ...(o.declineReason ? { declineReason: o.declineReason } : {}),
    amount: o.amount,
    currency: o.currency,
    merchantReference: o.merchantReference,
    merchantAgreementInstanceReference: o.merchantAgreementInstanceReference,
    transactionId,                          // explicit, so the merchant always receives the txn id
    ...(transactionId ? { cardTransactionInstanceReference: transactionId } : {}),
    [`${o.contextType === 'payment_link' ? 'paymentLinkInstanceReference' : o.contextType === 'checkout_session' ? 'checkoutSessionInstanceReference' : 'transactionContextReference'}`]: o.contextRef,
  };

  // 1) Per-merchant webhook delivery (the real callback to the correct merchant's endpoint).
  // Awaited with a single attempt so a slow/unreachable endpoint never blocks the payment, while
  // still capturing the request + the merchant's response for the audit trail.
  let webhookConfigured = false;
  let webhookEndpoint: string | undefined;
  let webhookResult: WebhookDeliveryResult | undefined;
  try {
    const merchant = await db
      .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
      .findOne(
        { merchantAgreementInstanceReference: o.merchantAgreementInstanceReference } as Partial<MerchantAgreementControlRecord>,
        { projection: { merchantWebhookEndpoint: 1, merchantWebhookSecret: 1 } },
      );
    webhookEndpoint = (merchant as { merchantWebhookEndpoint?: string } | null)?.merchantWebhookEndpoint;
    const secret = (merchant as { merchantWebhookSecret?: string } | null)?.merchantWebhookSecret;
    if (webhookEndpoint && secret) {
      webhookConfigured = true;
      try {
        webhookResult = await deliverWebhook(webhookEndpoint, { event: payload.event as string, timestamp: new Date().toISOString(), data: payload }, secret, { maxAttempts: 1 });
      } catch { /* never block the payment on a delivery failure */ }
    }
  } catch { /* merchant lookup failure never blocks the payment outcome */ }

  // 2) Unified-audit business event (visible + searchable in /system/audit-events) — now WITH the
  // webhook request (method/headers/body) and the merchant's response, for PCI DSS Req 10.7 auditing.
  emitProcessEvent(db, {
    entityType: 'transaction',
    entityId: transactionId ?? o.contextRef,
    processType: 'payment_processing',
    processAction: 'payment.callback',
    processOutcome: o.result === 'approved' ? 'approved' : 'rejected',
    performedByPartyReference: null,
    performedByRole: null,
    eventSummary: {
      result: o.result,
      merchantAgreementInstanceReference: o.merchantAgreementInstanceReference,
      cardToken: o.cardToken,
      cardTransactionInstanceReference: transactionId,
      responseCode: o.responseCode,
      ...(o.declineReason ? { declineReason: o.declineReason } : {}),
      contextType: o.contextType,
      webhookConfigured,
      ...(webhookEndpoint ? { webhookEndpoint } : {}),
      ...(webhookResult ? {
        webhook: {
          delivered: webhookResult.delivered,
          statusCode: webhookResult.statusCode,
          attempts: webhookResult.attempts,
          method: webhookResult.request.method,
          requestHeaders: webhookResult.request.headers,
          requestBody: webhookResult.request.body,
          response: webhookResult.response,
          ...(webhookResult.error ? { error: webhookResult.error } : {}),
        },
      } : (webhookConfigured ? {} : { note: 'No webhook endpoint configured for this merchant — set one in /system/merchant/webhooks.' })),
    },
    bianServiceDomain: 'Payment Order',
    bianControlRecordType: 'PaymentOrderProcedure',
  });

  // 3) Integration Hub audit event (inbound/outbound mechanism).
  try {
    await dispatchIntegration(db, 'generic', o.triggeredBy, payload, {
      entityType: 'transaction',
      entityId: transactionId ?? o.contextRef,
      processType: 'payment_processing',
    });
  } catch { /* audit dispatch never blocks the payment outcome */ }
}

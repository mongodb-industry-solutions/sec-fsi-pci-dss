// BIAN SD-64: Payment Order + SD-65: Payment Execution — prototype stub service
// Full implementation (DB persistence, idempotency, routing engine) scheduled for v5.

import { v4 as uuidv4 } from 'uuid';
import { PaymentOrderStatus } from '../models/paymentOrder.model';

let orderCounter = 1000;
function nextOrderRef() { return `PO-2026-${String(++orderCounter).padStart(6, '0')}`; }

export interface CreatePaymentOrderInput {
  merchantAgreementInstanceReference: string;
  paymentOrderMerchantReference: string;
  amount: number;
  currency: string;
  paymentOrderDescription?: string;
  idempotencyKey: string;
}

export async function createPaymentOrder(input: CreatePaymentOrderInput) {
  const id = uuidv4();
  return {
    paymentOrderInstanceReference: id,
    paymentOrderReference: nextOrderRef(),
    paymentOrderStatus: 'initiated' as PaymentOrderStatus,
    paymentOrderAmount: { amount: input.amount, currency: input.currency },
    merchantAgreementInstanceReference: input.merchantAgreementInstanceReference,
    paymentOrderMerchantReference: input.paymentOrderMerchantReference,
    idempotencyKey: input.idempotencyKey,
    paymentOrderExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    _stub: true,
    _note: 'v5: persisted to paymentOrder with TTL index; idempotency enforced by unique index on idempotencyKey',
  };
}

export async function confirmPaymentOrder(id: string, customerAgreementInstanceReference: string) {
  return {
    paymentOrderInstanceReference: id,
    paymentOrderStatus: 'confirmed' as PaymentOrderStatus,
    customerAgreementInstanceReference,
    paymentOrderConfirmedDateTime: new Date().toISOString(),
    _stub: true,
  };
}

export async function authorizePaymentOrder(id: string) {
  return {
    paymentOrderInstanceReference: id,
    paymentOrderStatus: 'authorized' as PaymentOrderStatus,
    linkedCardTransactionReference: uuidv4(),
    routingDecision: {
      processor: 'simulated_processor_v1',
      routedAt: new Date().toISOString(),
      routingReason: 'default_route',
    },
    paymentOrderAuthorizedDateTime: new Date().toISOString(),
    _stub: true,
    _note: 'v5: creates linked cardTransaction; triggers fraud evaluation via shared/services/fraudTrigger',
  };
}

export async function capturePaymentOrder(id: string) {
  return {
    paymentOrderInstanceReference: id,
    paymentOrderStatus: 'captured' as PaymentOrderStatus,
    paymentOrderCapturedDateTime: new Date().toISOString(),
    _stub: true,
  };
}

export async function voidPaymentOrder(id: string) {
  return {
    paymentOrderInstanceReference: id,
    paymentOrderStatus: 'voided' as PaymentOrderStatus,
    paymentOrderVoidedDateTime: new Date().toISOString(),
    _stub: true,
  };
}

export async function refundPaymentOrder(id: string, refundAmount: number, refundReason: string) {
  return {
    paymentOrderInstanceReference: id,
    paymentOrderStatus: 'refunded' as PaymentOrderStatus,
    refundRecord: {
      refundAmount,
      refundDateTime: new Date().toISOString(),
      refundReason,
    },
    _stub: true,
  };
}

export async function getPaymentOrder(id: string) {
  return {
    paymentOrderInstanceReference: id,
    paymentOrderReference: 'PO-2026-001001',
    paymentOrderStatus: 'authorized' as PaymentOrderStatus,
    paymentOrderAmount: { amount: 850.00, currency: 'USD' },
    merchantAgreementInstanceReference: 'mrch-5732-001',
    paymentOrderMerchantReference: 'ORD-2026-9999',
    routingDecision: { processor: 'simulated_processor_v1', routedAt: new Date().toISOString(), routingReason: 'default_route' },
    paymentOrderInitiatedDateTime: new Date().toISOString(),
    paymentOrderExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    _stub: true,
  };
}

// BIAN SD-64: Payment Order, MongoDB-backed service (v17)

import { Db } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import {
  PAYMENT_ORDER_COLLECTION,
  PaymentOrderControlRecord,
  PaymentOrderStatus,
} from '../models/paymentOrder.model';

let orderCounter = Date.now() % 1_000_000;
function nextOrderRef() {
  return `PO-2026-${String(++orderCounter).padStart(6, '0')}`;
}

export interface CreatePaymentOrderInput {
  merchantAgreementInstanceReference: string;
  paymentOrderMerchantReference: string;
  amount: number;
  currency: string;
  paymentOrderDescription?: string;
  idempotencyKey: string;
}

export async function createPaymentOrder(db: Db, input: CreatePaymentOrderInput) {
  const col = db.collection<PaymentOrderControlRecord>(PAYMENT_ORDER_COLLECTION);

  // Idempotency: return the existing order if the key was already used
  const existing = await col.findOne({ idempotencyKey: input.idempotencyKey });
  if (existing) {
    return {
      paymentOrderInstanceReference: existing.paymentOrderInstanceReference,
      paymentOrderReference: existing.paymentOrderReference,
      paymentOrderStatus: existing.paymentOrderStatus,
      paymentOrderAmount: existing.paymentOrderAmount,
      merchantAgreementInstanceReference: existing.merchantAgreementInstanceReference,
      paymentOrderMerchantReference: existing.paymentOrderMerchantReference,
      idempotencyKey: existing.idempotencyKey,
      paymentOrderExpiresAt: existing.paymentOrderExpiresAt.toISOString(),
      _idempotent: true,
    };
  }

  const now = new Date();
  const record: PaymentOrderControlRecord = {
    paymentOrderInstanceReference: uuidv4(),
    paymentOrderReference: nextOrderRef(),
    idempotencyKey: input.idempotencyKey,
    merchantAgreementInstanceReference: input.merchantAgreementInstanceReference,
    paymentOrderAmount: { amount: input.amount, currency: input.currency },
    paymentOrderMerchantReference: input.paymentOrderMerchantReference,
    paymentOrderDescription: input.paymentOrderDescription,
    paymentOrderStatus: 'initiated',
    paymentOrderCaptureStrategy: 'immediate',
    paymentOrderInitiatedDateTime: now,
    paymentOrderExpiresAt: new Date(now.getTime() + 86_400_000), // 24h TTL
    bianServiceDomain: 'Payment Order',
    bianControlRecordType: 'PaymentOrderProcedure',
    recordCreatedDateTime: now,
    recordUpdatedDateTime: now,
    schemaVersion: 1,
  };

  await col.insertOne(record);
  return {
    paymentOrderInstanceReference: record.paymentOrderInstanceReference,
    paymentOrderReference: record.paymentOrderReference,
    paymentOrderStatus: record.paymentOrderStatus,
    paymentOrderAmount: record.paymentOrderAmount,
    merchantAgreementInstanceReference: record.merchantAgreementInstanceReference,
    paymentOrderMerchantReference: record.paymentOrderMerchantReference,
    idempotencyKey: record.idempotencyKey,
    paymentOrderExpiresAt: record.paymentOrderExpiresAt.toISOString(),
  };
}

export async function getPaymentOrder(db: Db, id: string) {
  const doc = await db.collection<PaymentOrderControlRecord>(PAYMENT_ORDER_COLLECTION)
    .findOne({ paymentOrderInstanceReference: id });
  if (!doc) return null;
  return {
    paymentOrderInstanceReference: doc.paymentOrderInstanceReference,
    paymentOrderReference: doc.paymentOrderReference,
    paymentOrderStatus: doc.paymentOrderStatus,
    paymentOrderAmount: doc.paymentOrderAmount,
    merchantAgreementInstanceReference: doc.merchantAgreementInstanceReference,
    paymentOrderMerchantReference: doc.paymentOrderMerchantReference,
    linkedCardTransactionReference: doc.linkedCardTransactionReference,
    routingDecision: doc.routingDecision,
    paymentOrderInitiatedDateTime: doc.paymentOrderInitiatedDateTime?.toISOString(),
    paymentOrderConfirmedDateTime: doc.paymentOrderConfirmedDateTime?.toISOString(),
    paymentOrderAuthorizedDateTime: doc.paymentOrderAuthorizedDateTime?.toISOString(),
    paymentOrderCapturedDateTime: doc.paymentOrderCapturedDateTime?.toISOString(),
    paymentOrderSettledDateTime: doc.paymentOrderSettledDateTime?.toISOString(),
    paymentOrderExpiresAt: doc.paymentOrderExpiresAt?.toISOString(),
    paymentOrderExecutionReference: doc.paymentOrderExecutionReference,
  };
}

export async function confirmPaymentOrder(db: Db, id: string, customerAgreementInstanceReference: string) {
  const now = new Date();
  const result = await db.collection<PaymentOrderControlRecord>(PAYMENT_ORDER_COLLECTION).findOneAndUpdate(
    { paymentOrderInstanceReference: id, paymentOrderStatus: 'initiated' },
    {
      $set: {
        paymentOrderStatus: 'confirmed' as PaymentOrderStatus,
        customerAgreementInstanceReference,
        paymentOrderConfirmedDateTime: now,
        recordUpdatedDateTime: now,
      },
    },
    { returnDocument: 'after' },
  );
  if (!result) return null;
  return {
    paymentOrderInstanceReference: result.paymentOrderInstanceReference,
    paymentOrderStatus: result.paymentOrderStatus,
    customerAgreementInstanceReference: result.customerAgreementInstanceReference,
    paymentOrderConfirmedDateTime: result.paymentOrderConfirmedDateTime?.toISOString(),
  };
}

export async function authorizePaymentOrder(db: Db, id: string) {
  const now = new Date();
  const result = await db.collection<PaymentOrderControlRecord>(PAYMENT_ORDER_COLLECTION).findOneAndUpdate(
    { paymentOrderInstanceReference: id, paymentOrderStatus: { $in: ['initiated', 'confirmed'] } },
    {
      $set: {
        paymentOrderStatus: 'authorized' as PaymentOrderStatus,
        paymentOrderAuthorizedDateTime: now,
        routingDecision: { processor: 'simulated_processor_v1', routedAt: now, routingReason: 'default_route' },
        recordUpdatedDateTime: now,
      },
    },
    { returnDocument: 'after' },
  );
  if (!result) return null;
  return {
    paymentOrderInstanceReference: result.paymentOrderInstanceReference,
    paymentOrderStatus: result.paymentOrderStatus,
    linkedCardTransactionReference: result.linkedCardTransactionReference,
    routingDecision: result.routingDecision
      ? { ...result.routingDecision, routedAt: result.routingDecision.routedAt?.toISOString?.() ?? result.routingDecision.routedAt }
      : undefined,
    paymentOrderAuthorizedDateTime: result.paymentOrderAuthorizedDateTime?.toISOString(),
  };
}

// Terminal failure transition (e.g. issuer declined the tokenised charge). Persists so GET /:id
// agrees with the POST response instead of remaining stuck at 'initiated'.
export async function failPaymentOrder(db: Db, id: string) {
  const now = new Date();
  const result = await db.collection<PaymentOrderControlRecord>(PAYMENT_ORDER_COLLECTION).findOneAndUpdate(
    { paymentOrderInstanceReference: id, paymentOrderStatus: { $in: ['initiated', 'confirmed'] } },
    { $set: { paymentOrderStatus: 'failed' as PaymentOrderStatus, recordUpdatedDateTime: now } },
    { returnDocument: 'after' },
  );
  if (!result) return null;
  return {
    paymentOrderInstanceReference: result.paymentOrderInstanceReference,
    paymentOrderStatus: result.paymentOrderStatus,
  };
}

export async function capturePaymentOrder(db: Db, id: string) {
  const now = new Date();
  const result = await db.collection<PaymentOrderControlRecord>(PAYMENT_ORDER_COLLECTION).findOneAndUpdate(
    { paymentOrderInstanceReference: id, paymentOrderStatus: 'authorized' },
    {
      $set: {
        paymentOrderStatus: 'captured' as PaymentOrderStatus,
        paymentOrderCapturedDateTime: now,
        recordUpdatedDateTime: now,
      },
    },
    { returnDocument: 'after' },
  );
  if (!result) return null;
  return {
    paymentOrderInstanceReference: result.paymentOrderInstanceReference,
    paymentOrderStatus: result.paymentOrderStatus,
    paymentOrderCapturedDateTime: result.paymentOrderCapturedDateTime?.toISOString(),
  };
}

export async function voidPaymentOrder(db: Db, id: string) {
  const now = new Date();
  const result = await db.collection<PaymentOrderControlRecord>(PAYMENT_ORDER_COLLECTION).findOneAndUpdate(
    { paymentOrderInstanceReference: id, paymentOrderStatus: { $in: ['initiated', 'confirmed', 'authorized'] } },
    {
      $set: {
        paymentOrderStatus: 'voided' as PaymentOrderStatus,
        paymentOrderVoidedDateTime: now,
        recordUpdatedDateTime: now,
      },
    },
    { returnDocument: 'after' },
  );
  if (!result) return null;
  return {
    paymentOrderInstanceReference: result.paymentOrderInstanceReference,
    paymentOrderStatus: result.paymentOrderStatus,
    paymentOrderVoidedDateTime: result.paymentOrderVoidedDateTime?.toISOString(),
  };
}

export async function refundPaymentOrder(db: Db, id: string, refundAmount: number, refundReason: string) {
  const now = new Date();
  const result = await db.collection<PaymentOrderControlRecord>(PAYMENT_ORDER_COLLECTION).findOneAndUpdate(
    { paymentOrderInstanceReference: id, paymentOrderStatus: { $in: ['authorized', 'captured', 'settled'] } },
    {
      $set: {
        paymentOrderStatus: 'refunded' as PaymentOrderStatus,
        paymentOrderRefundedDateTime: now,
        refundRecord: { refundAmount, refundDateTime: now, refundReason },
        recordUpdatedDateTime: now,
      },
    },
    { returnDocument: 'after' },
  );
  if (!result) return null;
  return {
    paymentOrderInstanceReference: result.paymentOrderInstanceReference,
    paymentOrderStatus: result.paymentOrderStatus,
    refundRecord: result.refundRecord
      ? { ...result.refundRecord, refundDateTime: result.refundRecord.refundDateTime?.toISOString?.() ?? result.refundRecord.refundDateTime }
      : undefined,
  };
}

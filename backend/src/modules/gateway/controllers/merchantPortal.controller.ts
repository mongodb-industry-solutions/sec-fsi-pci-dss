/**
 * Merchant Portal API — OAuth-authenticated (ADR-037)
 * Routes: /api/v1/merchant/portal/*
 * All responses are scoped to the authenticated merchant's own records.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Db } from 'mongodb';
import { validateMerchantToken } from '../../../vendors/middleware/validateMerchantToken';
import { MERCHANT_AGREEMENT_COLLECTION, MerchantAgreementControlRecord } from '../models/merchantAgreement.model';
import { NOTIFICATION_COLLECTION } from '../../notification/notification.model';

export async function merchantPortalController(fastify: FastifyInstance) {
  const db = (): Db => (fastify as any).db as Db;

  // ── GET /api/v1/merchant/portal/me ─────────────────────────────────────────
  fastify.get('/me', {
    schema: {
      tags: ['merchant-portal'],
      summary: 'Merchant profile (OAuth)',
      description: 'Returns the authenticated merchant\'s own profile. Scope required: read:merchant_profile',
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    await validateMerchantToken(req, reply, 'read:merchant_profile');
    if (!req.merchantContext) return;

    const merchant = await db()
      .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
      .findOne({ merchantAgreementInstanceReference: req.merchantContext.merchantId });

    if (!merchant) return reply.status(404).send({ error: 'Merchant not found' });

    const { merchantOAuthClient, ...rest } = merchant as any;
    return {
      ...rest,
      oauthClientId: merchant.merchantOAuthClient?.oauthClientId,
      oauthScopes: merchant.merchantOAuthClient?.oauthScopes,
      oauthGrantTypes: merchant.merchantOAuthClient?.oauthGrantTypes,
      oauthClientStatus: merchant.merchantOAuthClient?.oauthClientStatus,
    };
  });

  // ── GET /api/v1/merchant/portal/transactions ────────────────────────────────
  fastify.get('/transactions', {
    schema: {
      tags: ['merchant-portal'],
      summary: 'Merchant transactions (OAuth)',
      description: 'Returns the merchant\'s own transaction metadata. No customer PII (PCI DSS Req 7). Scope required: read:transactions',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 100 },
          status: { type: 'string' },
          from: { type: 'string', format: 'date-time' },
          to: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    await validateMerchantToken(req, reply, 'read:transactions');
    if (!req.merchantContext) return;

    const q = req.query as Record<string, any>;
    const page = Math.max(1, parseInt(q.page ?? '1'));
    const limit = Math.min(100, parseInt(q.limit ?? '20'));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {
      cardTransactionMerchantName: req.merchantContext.merchantName,
    };
    if (q.status) filter.cardTransactionStatus = q.status;
    if (q.from || q.to) {
      filter.cardTransactionDateTime = {};
      if (q.from) filter.cardTransactionDateTime.$gte = new Date(q.from);
      if (q.to) filter.cardTransactionDateTime.$lte = new Date(q.to);
    }

    const col = db().collection('cardTransactionLog');
    const [items, total] = await Promise.all([
      col.find(filter, {
        projection: {
          cardTransactionInstanceReference: 1,
          cardTransactionAmount: 1,
          cardTransactionDateTime: 1,
          cardTransactionStatus: 1,
          cardTransactionType: 1,
          cardTransactionMaskedPanDisplay: 1,
          // NO customer PII: no email, phone, address, cardholder name (Req 7)
        },
      }).sort({ cardTransactionDateTime: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments(filter),
    ]);

    return { total, page, limit, items };
  });

  // ── GET /api/v1/merchant/portal/notifications ───────────────────────────────
  fastify.get('/notifications', {
    schema: {
      tags: ['merchant-portal'],
      summary: 'Merchant notifications (OAuth)',
      description: 'Returns notifications for the authenticated merchant. Scope required: read:notifications',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', default: 1 },
          limit: { type: 'number', default: 20, maximum: 50 },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    await validateMerchantToken(req, reply, 'read:notifications');
    if (!req.merchantContext) return;

    // Resolve merchant owner party reference for notification lookup
    const merchant = await db()
      .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
      .findOne({ merchantAgreementInstanceReference: req.merchantContext.merchantId });

    if (!merchant?.merchantOwnerPartyReference) {
      return { total: 0, items: [] };
    }

    const q = req.query as Record<string, any>;
    const page = Math.max(1, parseInt(q.page ?? '1'));
    const limit = Math.min(50, parseInt(q.limit ?? '20'));
    const skip = (page - 1) * limit;

    const filter = { recipientPartyReference: merchant.merchantOwnerPartyReference };
    const col = db().collection(NOTIFICATION_COLLECTION);

    const [items, total] = await Promise.all([
      col.find(filter).sort({ recordCreatedDateTime: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments(filter),
    ]);

    return { total, page, limit, items };
  });

  // ── POST /api/v1/merchant/portal/notifications/:id/read ────────────────────
  fastify.post('/notifications/:id/read', {
    schema: {
      tags: ['merchant-portal'],
      summary: 'Mark notification as read (OAuth)',
      description: 'Marks a merchant notification as read. Scope required: read:notifications',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    await validateMerchantToken(req, reply, 'read:notifications');
    if (!req.merchantContext) return;

    const { id } = req.params as { id: string };
    const merchant = await db()
      .collection<MerchantAgreementControlRecord>(MERCHANT_AGREEMENT_COLLECTION)
      .findOne({ merchantAgreementInstanceReference: req.merchantContext.merchantId });

    if (!merchant?.merchantOwnerPartyReference) {
      return reply.status(403).send({ error: 'No owner party reference for this merchant' });
    }

    const result = await db().collection(NOTIFICATION_COLLECTION).updateOne(
      {
        notificationInstanceReference: id,
        recipientPartyReference: merchant.merchantOwnerPartyReference,
      },
      { $set: { notificationStatus: 'read' } },
    );

    return { updated: result.modifiedCount > 0 };
  });
}

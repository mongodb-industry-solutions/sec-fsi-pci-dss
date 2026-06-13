import { FastifyInstance } from 'fastify';
import {
  FdsInboundPayload,
  AmlInboundPayload,
  KycInboundPayload,
  KybInboundPayload,
  HrpInboundPayload,
  CreditBureauInboundPayload,
  CardAuthInboundPayload,
  CardIssuerInboundPayload,
  GenericInboundPayload,
} from '../models/externalProviderArrangement.model';

// Internal stub endpoints — NOT JWT-authenticated, validated by X-Integration-Source header.
// These endpoints simulate external provider responses for providers configured with
// a localhost endpoint (ADR-025 D3: endpoint-first dispatch).

function requireIntegrationSource(request: { headers: Record<string, string | string[] | undefined> }, reply: { code: (n: number) => { send: (b: unknown) => void } }) {
  const source = request.headers['x-integration-source'];
  if (!source) {
    reply.code(401).send({ error: 'X-Integration-Source header required' });
    return false;
  }
  return true;
}

export async function integrationInternalController(fastify: FastifyInstance) {
  const baseOpts = {
    schema: {
      tags: ['internal'],
      headers: {
        type: 'object',
        required: ['x-integration-source'],
        properties: { 'x-integration-source': { type: 'string' } },
      },
    },
    // Skip JWT auth for internal stub endpoints
    config: { skipAuth: true },
  };

  // ── POST /internal/fds/score ──────────────────────────────────────────────
  fastify.post('/fds/score', baseOpts, async (request, reply) => {
    if (!requireIntegrationSource(request as never, reply as never)) return;
    const body = request.body as Record<string, unknown>;
    const amount = (body.transactionAmount as number) ?? 0;
    const response: FdsInboundPayload = {
      riskScore: amount > 1000 ? 75 : amount > 500 ? 45 : 15,
      fraudFlag: amount > 1000,
      recommendation: amount > 1000 ? 'review' : 'approve',
      rulesFired: amount > 1000 ? ['HIGH_VALUE_TXN', 'VELOCITY_CHECK'] : [],
    };
    return reply.send(response);
  });

  // ── POST /internal/aml/score ──────────────────────────────────────────────
  fastify.post('/aml/score', baseOpts, async (request, reply) => {
    if (!requireIntegrationSource(request as never, reply as never)) return;
    const response: AmlInboundPayload = {
      alertLevel: 'none',
      matchedPatterns: [],
      requiresReview: false,
    };
    return reply.send(response);
  });

  // ── POST /internal/kyc/score ──────────────────────────────────────────────
  fastify.post('/kyc/score', baseOpts, async (request, reply) => {
    if (!requireIntegrationSource(request as never, reply as never)) return;
    const response: KycInboundPayload = {
      verificationStatus: 'pass',
      confidenceScore: 92,
      failureReasons: [],
    };
    return reply.send(response);
  });

  // ── POST /internal/kyb/score ──────────────────────────────────────────────
  fastify.post('/kyb/score', baseOpts, async (request, reply) => {
    if (!requireIntegrationSource(request as never, reply as never)) return;
    const response: KybInboundPayload = {
      verificationStatus: 'pass',
      businessRiskLevel: 'low',
      sanctionsMatch: false,
      failureReasons: [],
    };
    return reply.send(response);
  });

  // ── POST /internal/hrp/score ──────────────────────────────────────────────
  fastify.post('/hrp/score', baseOpts, async (request, reply) => {
    if (!requireIntegrationSource(request as never, reply as never)) return;
    const response: HrpInboundPayload = {
      sanctionsHit: false,
      pepHit: false,
      matchedLists: [],
      riskRating: 'low',
    };
    return reply.send(response);
  });

  // ── POST /internal/credit_bureau/score ───────────────────────────────────
  fastify.post('/credit_bureau/score', baseOpts, async (request, reply) => {
    if (!requireIntegrationSource(request as never, reply as never)) return;
    const response: CreditBureauInboundPayload = {
      creditScore: 720,
      creditRating: 'A',
      defaultProbability: 0.02,
    };
    return reply.send(response);
  });

  // ── POST /internal/card_auth/score ───────────────────────────────────────
  fastify.post('/card_auth/score', baseOpts, async (request, reply) => {
    if (!requireIntegrationSource(request as never, reply as never)) return;
    const response: CardAuthInboundPayload = {
      authorizationCode: 'AUTH' + Math.floor(Math.random() * 100000).toString().padStart(6, '0'),
      authorizationStatus: 'approved',
      responseCode: '00',
    };
    return reply.send(response);
  });

  // ── POST /internal/card_issuer/score ─────────────────────────────────────
  fastify.post('/card_issuer/score', baseOpts, async (request, reply) => {
    if (!requireIntegrationSource(request as never, reply as never)) return;
    const response: CardIssuerInboundPayload = {
      cardStatus: 'active',
      actionConfirmed: true,
    };
    return reply.send(response);
  });

  // ── POST /internal/generic/score ─────────────────────────────────────────
  fastify.post('/generic/score', baseOpts, async (request, reply) => {
    if (!requireIntegrationSource(request as never, reply as never)) return;
    const response: GenericInboundPayload = {
      status: 'ok',
      result: { processed: true },
    };
    return reply.send(response);
  });
}

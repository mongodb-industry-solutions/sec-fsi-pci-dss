import { FastifyInstance } from 'fastify';
import {
  validateCallback,
  processFdsCallback,
  processAmlCallback,
  processKycCallback,
  processKybCallback,
  processHrpCallback,
  processCardAuthorizationCallback,
  processCardIssuerCallback,
  processGenericCallback,
} from '../services/integrationCallback.service';

const E = { type: 'object', properties: { error: { type: 'string' } } };

function webhookSchema(summary: string, description: string) {
  return {
    schema: {
      tags: ['providers'],
      summary,
      description,
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Integration provider ID (returned when the provider was registered)' },
        },
      },
      headers: {
        type: 'object',
        properties: {
          'x-webhook-signature': {
            type: 'string',
            description: 'HMAC-SHA256 hex digest of the raw request body, signed with the provider\'s webhook secret. Required when the provider has signature validation enabled.',
          },
        },
      },
      body: {
        type: 'object',
        additionalProperties: true,
        description: 'Provider-specific callback payload. Arbitrary JSON; field mapping rules configured on the provider transform it into the internal canonical format.',
      },
      response: {
        200: {
          type: 'object',
          description: 'Callback acknowledged and queued for processing.',
          properties: { received: { type: 'boolean', description: 'Always true on success.' } },
        },
        401: { ...E, description: 'Invalid or missing webhook signature.' },
        404: { ...E, description: 'Integration provider not found for the given id.' },
      },
    },
  };
}

export async function integrationWebhookController(fastify: FastifyInstance) {
  // ── POST /providers/callback/fds/:id ──────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/fds/:id',
    webhookSchema(
      'FDS callback (Fraud Detection System)',
      'Inbound async callback from a Fraud Detection System provider (capability: fraud_detection). ' +
      'Validates the X-Webhook-Signature HMAC, then applies the provider\'s inbound field-mapping rules ' +
      'and records a `fraudDiagnosis.externalScore` event on the active fraud case. ' +
      'Called by the provider after it finishes evaluating a transaction posted by the PSP.',
    ),
    async (request, reply) => {
      const { id } = request.params;
      const signature = request.headers['x-webhook-signature'] as string | undefined;
      const bodyRaw = JSON.stringify(request.body);

      const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
      if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

      await processFdsCallback(fastify.db, provider!, request.body as never);
      return { received: true };
    },
  );

  // ── POST /providers/callback/aml/:id ──────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/aml/:id',
    webhookSchema(
      'AML callback (Anti-Money Laundering)',
      'Inbound async callback from an Anti-Money Laundering monitoring provider (capability: aml_monitoring). ' +
      'Validates the HMAC signature, applies inbound field-mapping, and records a `compliance.amlScreening` event. ' +
      'Triggered when the AML provider completes a batch or real-time screening run.',
    ),
    async (request, reply) => {
      const { id } = request.params;
      const signature = request.headers['x-webhook-signature'] as string | undefined;
      const bodyRaw = JSON.stringify(request.body);

      const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
      if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

      await processAmlCallback(fastify.db, provider!, request.body as never);
      return { received: true };
    },
  );

  // ── POST /providers/callback/kyc/:id ──────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/kyc/:id',
    webhookSchema(
      'KYC callback (Know Your Customer)',
      'Inbound async callback from a KYC identity-verification provider (capability: kyc_identity). ' +
      'Validates the HMAC signature, applies inbound field-mapping, and records a `customer.kycVerification` event. ' +
      'Called when the provider completes document or biometric identity checks for a customer.',
    ),
    async (request, reply) => {
      const { id } = request.params;
      const signature = request.headers['x-webhook-signature'] as string | undefined;
      const bodyRaw = JSON.stringify(request.body);

      const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
      if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

      await processKycCallback(fastify.db, provider!, request.body as never);
      return { received: true };
    },
  );

  // ── POST /providers/callback/kyb/:id ──────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/kyb/:id',
    webhookSchema(
      'KYB callback (Know Your Business)',
      'Inbound async callback from a KYB business-verification provider (capability: kyb_business). ' +
      'Validates the HMAC signature, applies inbound field-mapping, and records a `merchant.kybVerification` event. ' +
      'Called when the provider completes company registration, beneficial-ownership, or risk-rating checks.',
    ),
    async (request, reply) => {
      const { id } = request.params;
      const signature = request.headers['x-webhook-signature'] as string | undefined;
      const bodyRaw = JSON.stringify(request.body);

      const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
      if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

      await processKybCallback(fastify.db, provider!, request.body as never);
      return { received: true };
    },
  );

  // ── POST /providers/callback/hrp/:id ──────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/hrp/:id',
    webhookSchema(
      'HRP / Sanctions callback (High-Risk Profile)',
      'Inbound async callback from a High-Risk Profile or sanctions-screening provider (capability: hrp_sanctions). ' +
      'Validates the HMAC signature, applies inbound field-mapping, and records a `compliance.sanctionsScreening` event. ' +
      'Called after the provider completes PEP / OFAC / sanctions list checks.',
    ),
    async (request, reply) => {
      const { id } = request.params;
      const signature = request.headers['x-webhook-signature'] as string | undefined;
      const bodyRaw = JSON.stringify(request.body);

      const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
      if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

      await processHrpCallback(fastify.db, provider!, request.body as never);
      return { received: true };
    },
  );

  // ── POST /providers/callback/generic/:id ──────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/generic/:id',
    webhookSchema(
      'Generic provider callback',
      'Inbound async callback for any provider registered with capability: generic. ' +
      'Validates the HMAC signature and applies inbound field-mapping; the resulting event type is ' +
      'determined by the provider\'s fieldMappingConfig.eventType value. ' +
      'Use this endpoint when the provider does not match a specific capability route above.',
    ),
    async (request, reply) => {
      const { id } = request.params;
      const signature = request.headers['x-webhook-signature'] as string | undefined;
      const bodyRaw = JSON.stringify(request.body);

      const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
      if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

      await processGenericCallback(fastify.db, provider!, request.body as never);
      return { received: true };
    },
  );

  // ── POST /providers/callback/card/authorization/:id ───────────────────────
  fastify.post<{ Params: { id: string } }>('/card/authorization/:id',
    webhookSchema(
      'Card authorization network callback',
      'Inbound async callback from a card-authorization network provider (capability: card_authorization). ' +
      'Validates the HMAC signature and records an `authorization.response` event that resolves the ' +
      'pending authorization saga for the linked card transaction. ' +
      'The `:id` must match an active provider with mode: async and capability card_authorization.',
    ),
    async (request, reply) => {
      const { id } = request.params;
      const signature = request.headers['x-webhook-signature'] as string | undefined;
      const bodyRaw = JSON.stringify(request.body);

      const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
      if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

      await processCardAuthorizationCallback(fastify.db, provider!, request.body as never);
      return { received: true };
    },
  );

  // ── POST /providers/callback/card/issuer/:id ──────────────────────────────
  fastify.post<{ Params: { id: string } }>('/card/issuer/:id',
    webhookSchema(
      'Card issuer (bank) callback',
      'Inbound async callback from the card issuer (external bank/card-scheme, capability: card_issuer). ' +
      'Validates the HMAC signature, applies inbound field-mapping, and records a `cardIssuer.response` event. ' +
      'The PSP calls the issuer to verify sensitive authentication data (SAD) without storing it; ' +
      'the issuer posts its decision back to this endpoint.',
    ),
    async (request, reply) => {
      const { id } = request.params;
      const signature = request.headers['x-webhook-signature'] as string | undefined;
      const bodyRaw = JSON.stringify(request.body);

      const { valid, provider, errorCode } = await validateCallback(fastify.db, id, bodyRaw, signature);
      if (!valid) return reply.code(errorCode ?? 401).send({ error: 'Invalid or missing webhook signature' });

      await processCardIssuerCallback(fastify.db, provider!, request.body as never);
      return { received: true };
    },
  );
}

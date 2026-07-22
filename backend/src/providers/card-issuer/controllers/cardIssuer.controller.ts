// Card Issuer capability module controller; STATIC routes (ADR-029).
import { FastifyInstance } from 'fastify';
import { validateCardIssuer, resolveCardIssuerConfig } from '../services/cardIssuer.service';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';
import { emitComplianceEvent } from '../../../modules/provider/services/businessProcessEvent.service';
import { requirePermission } from '../../../vendors/middleware/acl';
import { requireInternalProvider } from '../../../modules/provider/services/capabilityGate.service';
import {
  listAllCards,
  getCardByIdAny,
  registerCardForCustomer,
  updateCardMetadata,
  setCardActivation,
  revokeCard,
} from '../../../modules/customer/services/paymentCard.service';
import type { PaymentCardManagementControlRecord } from '../../../modules/customer/models/paymentCard.model';
import type { JwtUserPayload } from '../../../shared/models/identity.model';

// v29 §8: aggregated list-access audit is opt-in (default off) to avoid flooding the ledger.
const AUDIT_LIST_ACCESS = process.env.PSP_AUDIT_LIST_ACCESS === 'true';

export async function cardIssuerController(fastify: FastifyInstance) {
  const CAP = 'card-issuer';
  // v29 admin gate: cards* routes require the operations_officer permission AND the card-issuer
  // capability resolving to its internal built-in provider (else 409 managed_externally).
  const gate = requireInternalProvider('card_issuer');

  fastify.post('/score', {
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Card issuer validation engine invocation (internal loopback)',
      description: 'Internal card-issuer (bank) validation engine. Called by the integration router (ADR-029) '
        + 'when no external card-issuer vendor is active. Validates the card format, network, and SAD (CVV check) '
        + 'without storing any CHD. PCI DSS Req 3.3: CVV is validated and immediately discarded. '
        + 'Not JWT-authenticated; requires `X-Integration-Source` header.',
      headers: { type: 'object', required: ['x-integration-source'], properties: { 'x-integration-source': { type: 'string', description: 'Caller identity header.' } } },
      body: {
        type: 'object',
        additionalProperties: true,
        description: 'Card validation payload. May include maskedPan, network, cvv (validated and immediately discarded — never stored). Forwarded by the integration router.',
      },
      response: {
        200: {
          type: 'object',
          description: 'Card issuer validation result.',
          properties: {
            actionConfirmed:     { type: 'boolean', description: 'True when the card passed all issuer checks.' },
            responseCode:        { type: 'string', description: 'ISO 8583-style response code.' },
            network:             { type: 'string', description: 'Resolved card network (e.g. VISA, MASTERCARD).' },
            cvvValidationResult: { type: 'string', enum: ['match', 'mismatch', 'not_provided', 'not_supported'], description: 'CVV check outcome.' },
            decisionReason:      { type: 'string', description: 'Human-readable reason for approval or rejection.' },
          },
        },
        401: { type: 'object', properties: { error: { type: 'string' } }, description: 'Missing X-Integration-Source header.' },
      },
    },
    config: { skipAuth: true },
  }, async (request, reply) => {
    if (!request.headers['x-integration-source']) {
      return reply.code(401).send({ error: 'X-Integration-Source header required' });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;

    // Apply the admin-configured simulator rules (valid CVV, supported networks, format checks).
    const stored = await getCapabilityModuleConfig(fastify.db, CAP);
    const config = resolveCardIssuerConfig(stored?.moduleConfig as Record<string, unknown> | undefined);
    const result = validateCardIssuer(body, config);

    // Correlation keys for audit/monitoring (PCI DSS Req 10): link the validation to the
    // transaction and the fraud case when the caller provides them.
    const transactionId = (body.transactionId ?? body.cardTransactionInstanceReference) as string | undefined;
    const caseReference = (body.caseReference ?? body.fraudDiagnosisCaseReference ?? body.fraudDiagnosisInstanceReference) as string | undefined;

    // Complete, PCI-safe event log: the request and response payloads, correlated to the
    // transaction / case. NEVER includes the PAN or CVV; only masked PAN, network and whether a
    // CVV was supplied. The audit sanitizer also strips any CHD key as a second line of defence.
    const requestLog = {
      maskedPan: (body.maskedPan ?? body.cardTransactionMaskedPanDisplay) as string | undefined,
      networkHint: (body.network ?? body.cardNetwork) as string | undefined,
      cvvProvided: body.cvv !== undefined || body.cvv2 !== undefined || body.cvc !== undefined,
      integrationSource: request.headers['x-integration-source'] as string,
    };

    emitComplianceEvent(fastify.db, {
      entityType: transactionId ? 'transaction' : 'card',
      entityId: transactionId ?? (requestLog.maskedPan ?? 'card-issuer-module'),
      processType: 'card_management',
      // Single closing action (§9.1): the verdict lives in processOutcome + eventSummary.response,
      // not in the event name (no separate approved/declined names).
      processAction: 'card.issuer.validation.completed',
      processOutcome: result.actionConfirmed ? 'approved' : 'rejected',
      performedByPartyReference: null,
      performedByRole: null,
      eventSummary: {
        module: CAP,
        request: requestLog,
        response: {
          approved: result.actionConfirmed,
          responseCode: result.responseCode,
          network: result.network,
          cvvValidationResult: result.cvvValidationResult,
          decisionReason: result.decisionReason,
        },
        transactionId,
        caseReference,
      },
      bianServiceDomain: 'SD-88 Payment Card',
      bianControlRecordType: 'PaymentCardValidation',
    });

    return reply.send(result);
  });

  fastify.get('/config', {
    preHandler: requirePermission('modules', 'view'),
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Get card-issuer module configuration',
      description: 'Returns the active card-issuer validation engine configuration (valid CVV rules, supported networks, format checks).',
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async () => {
    return (await getCapabilityModuleConfig(fastify.db, CAP)) ?? { capability: CAP, moduleConfig: {} };
  });

  fastify.put('/config', {
    preHandler: requirePermission('modules', 'manage'),
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Update card-issuer module configuration',
      description: 'Replaces the card-issuer engine configuration (CVV rules, network support, PAN format). Changes take effect on the next invocation.',
      body: { type: 'object', properties: { moduleConfig: { type: 'object', additionalProperties: true } } },
      response: {
        200: { type: 'object', properties: { capability: { type: 'string' }, moduleConfig: { type: 'object', additionalProperties: true } } },
      },
    },
  }, async (request) => {
    const body = request.body as { moduleConfig?: Record<string, unknown> };
    return upsertCapabilityModuleConfig(fastify.db, CAP, { moduleConfig: body.moduleConfig ?? {} });
  });

  // ── v29 GLOBAL CARD ADMINISTRATION (SD-88, built-in module surface) ──────────────────────────
  // Global cross-party administration of cardholder cards, distinct from the customer/staff
  // self-service surface (/api/v1/customer/:customerId/cards). Gated to operations_officer (PCI Req 7)
  // and to the card-issuer capability resolving to its internal provider (409 managed_externally).
  // PCI DSS: PAN always masked; CVV/PIN never accepted or returned; every mutation audited (Req 10).

  const cardListItem = {
    type: 'object',
    properties: {
      paymentCardInstanceReference: { type: 'string' },
      customerAgreementInstanceReference: { type: 'string' },
      paymentCardReference: { type: 'string', description: 'PAN surrogate token (not CHD).' },
      paymentCardMaskedPanDisplay: { type: 'string' },
      paymentCardNetwork: { type: 'string', nullable: true },
      paymentCardStatus: { type: 'string' },
      paymentCardIsPreferred: { type: 'boolean', nullable: true },
      paymentCardAlias: { type: 'string', nullable: true },
      fundingPayoutAccountInstanceReference: { type: 'string', nullable: true },
      recordCreatedDateTime: { type: 'string', format: 'date-time', nullable: true },
    },
  };

  // GET /cards — global paginated list (display-safe; no expiry).
  fastify.get('/cards', {
    preHandler: [requirePermission('cards', 'view'), gate],
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'List all payment cards (global administration)',
      description: 'Cross-party global card inventory for the operations officer (SD-88). Display-safe '
        + 'rows only: surrogate token, masked PAN, network, status, agreement, dates. No full PAN, no CVV, '
        + 'no expiry (per-card detail only). Gated: operations_officer + internal card-issuer provider.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          network: { type: 'string', enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'] },
          status: { type: 'string', enum: ['issued', 'active', 'pending_activation', 'blocked', 'suspended', 'revoked', 'expired'] },
          agreement: { type: 'string', description: 'Filter by customerAgreementInstanceReference.' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            results: { type: 'array', items: cardListItem },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
        403: { $ref: 'Error#' },
        409: { description: 'Capability managed by an external provider.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const q = (request.query ?? {}) as { page?: number; limit?: number; network?: string; status?: string; agreement?: string };
    const result = await listAllCards(fastify.db, q);
    if (AUDIT_LIST_ACCESS) {
      const user = (request as { user?: JwtUserPayload }).user;
      emitComplianceEvent(fastify.db, {
        entityType: 'card', entityId: 'card-issuer-admin-list',
        processType: 'card_management', processAction: 'admin.cards.listed', processOutcome: 'approved',
        performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
        eventSummary: { module: CAP, count: result.results.length, filters: q },
        bianServiceDomain: 'Payment Card', bianControlRecordType: 'PaymentCardManagement',
      });
    }
    return reply.send(result);
  });

  // GET /cards/:cardId — global per-card detail (includes QE:none expiry; audited).
  fastify.get('/cards/:cardId', {
    preHandler: [requirePermission('cards', 'view'), gate],
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Get one payment card (global administration detail)',
      description: 'Cross-party card detail for the operations officer. Includes the QE:none expiry '
        + '(CHD but not SAD; business need-to-know to verify registration). Full PAN and CVV/PIN are '
        + 'never stored, never returned. Access is audited (card.accessed, PCI Req 10).',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['cardId'], properties: { cardId: { type: 'string' } } },
      response: {
        200: { type: 'object', additionalProperties: true },
        403: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
        409: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string };
    const card = await getCardByIdAny(fastify.db, cardId);
    if (!card) return reply.status(404).send({ error: 'Card not found' });
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'card', entityId: cardId,
      processType: 'card_management', processAction: 'card.accessed', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, maskedPan: card.paymentCardMaskedPanDisplay, network: card.paymentCardNetwork, customerAgreementInstanceReference: card.customerAgreementInstanceReference },
      bianServiceDomain: 'Payment Card', bianControlRecordType: 'PaymentCardManagement',
    });
    return reply.send(card);
  });

  // POST /cards — register a card for an agreement (reuses the domain service; rejects CVV/PIN by schema).
  fastify.post('/cards', {
    preHandler: [requirePermission('cards', 'manage'), gate],
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Register a payment card for an agreement (global administration)',
      description: 'Registers a card-on-file for a customerAgreementInstanceReference. Reuses the SD-88 '
        + 'domain service (dedup via the shared registry). CVV/PIN are rejected by schema (additionalProperties:false).',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['customerAgreementInstanceReference', 'cardToken', 'paymentCardMaskedPanDisplay'],
        properties: {
          customerAgreementInstanceReference: { type: 'string' },
          cardToken: { type: 'string', description: 'PAN surrogate token (not CHD).' },
          paymentCardMaskedPanDisplay: { type: 'string', description: 'Display-safe last-4 (****-****-****-XXXX).' },
          paymentCardExpirationDate: { type: 'string', description: 'MM/YY, stored QE:none.' },
          paymentCardNetwork: { type: 'string', enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'] },
          paymentCardIsPreferred: { type: 'boolean', default: false },
          paymentCardAlias: { type: 'string', maxLength: 40 },
        },
      },
      response: {
        201: { type: 'object', properties: { paymentCardInstanceReference: { type: 'string' }, paymentCardStatus: { type: 'string' }, reused: { type: 'boolean' } } },
        403: { $ref: 'Error#' },
        409: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      customerAgreementInstanceReference: string;
      cardToken: string;
      paymentCardMaskedPanDisplay: string;
      paymentCardExpirationDate?: string;
      paymentCardNetwork?: PaymentCardManagementControlRecord['paymentCardNetwork'];
      paymentCardIsPreferred?: boolean;
      paymentCardAlias?: string;
    };
    const result = await registerCardForCustomer(fastify.db, {
      customerAgreementInstanceReference: body.customerAgreementInstanceReference,
      cardToken: body.cardToken,
      paymentCardMaskedPanDisplay: body.paymentCardMaskedPanDisplay,
      paymentCardIsPreferred: body.paymentCardIsPreferred ?? false,
      ...(body.paymentCardExpirationDate ? { paymentCardExpirationDate: body.paymentCardExpirationDate } : {}),
      ...(body.paymentCardNetwork ? { paymentCardNetwork: body.paymentCardNetwork } : {}),
      ...(body.paymentCardAlias ? { paymentCardAlias: body.paymentCardAlias } : {}),
    });
    const user = (request as { user?: JwtUserPayload }).user;
    if (!result.reused) emitComplianceEvent(fastify.db, {
      entityType: 'card', entityId: result.paymentCardInstanceReference,
      processType: 'card_management', processAction: 'card.registered', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, maskedPan: body.paymentCardMaskedPanDisplay, network: body.paymentCardNetwork, customerAgreementInstanceReference: body.customerAgreementInstanceReference },
      bianServiceDomain: 'Payment Card', bianControlRecordType: 'PaymentCardManagement',
    });
    return reply.status(201).send(result);
  });

  // PATCH /cards/:cardId — update alias/note metadata.
  fastify.patch('/cards/:cardId', {
    preHandler: [requirePermission('cards', 'manage'), gate],
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Update a card alias / note (global administration)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['cardId'], properties: { cardId: { type: 'string' } } },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          paymentCardAlias: { type: 'string', maxLength: 40 },
          paymentCardCustomerNote: { type: 'string', maxLength: 280 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 400: { $ref: 'Error#' }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string };
    const body = (request.body ?? {}) as { paymentCardAlias?: string; paymentCardCustomerNote?: string };
    if (body.paymentCardAlias === undefined && body.paymentCardCustomerNote === undefined) {
      return reply.status(400).send({ error: 'Provide paymentCardAlias and/or paymentCardCustomerNote' });
    }
    const existing = await getCardByIdAny(fastify.db, cardId);
    if (!existing) return reply.status(404).send({ error: 'Card not found' });
    const agreementRef = existing.customerAgreementInstanceReference as string;
    const updated = await updateCardMetadata(fastify.db, agreementRef, cardId, {
      paymentCardAlias: body.paymentCardAlias,
      paymentCardCustomerNote: body.paymentCardCustomerNote,
    });
    if (!updated) return reply.status(404).send({ error: 'Card not found' });
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'card', entityId: cardId,
      processType: 'card_management', processAction: 'card.updated', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, customerAgreementInstanceReference: agreementRef, fields: Object.keys(body) },
      bianServiceDomain: 'Payment Card', bianControlRecordType: 'PaymentCardManagement',
    });
    return reply.send(updated);
  });

  // PATCH /cards/:cardId/status — activate / suspend.
  fastify.patch('/cards/:cardId/status', {
    preHandler: [requirePermission('cards', 'manage'), gate],
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Activate / deactivate a card (global administration)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['cardId'], properties: { cardId: { type: 'string' } } },
      body: { type: 'object', required: ['active'], additionalProperties: false, properties: { active: { type: 'boolean' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string };
    const { active } = request.body as { active: boolean };
    const existing = await getCardByIdAny(fastify.db, cardId);
    if (!existing) return reply.status(404).send({ error: 'Card not found' });
    const agreementRef = existing.customerAgreementInstanceReference as string;
    const updated = await setCardActivation(fastify.db, agreementRef, cardId, active);
    if (!updated) return reply.status(404).send({ error: 'Card not found or not in a toggleable state' });
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'card', entityId: cardId,
      processType: 'card_management', processAction: active ? 'card.reactivated' : 'card.deactivated', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, customerAgreementInstanceReference: agreementRef, maskedPan: updated.paymentCardMaskedPanDisplay, status: updated.paymentCardStatus },
      bianServiceDomain: 'Payment Card', bianControlRecordType: 'PaymentCardManagement',
    });
    return reply.send(updated);
  });

  // DELETE /cards/:cardId — revoke (soft-delete; record retained for audit).
  fastify.delete('/cards/:cardId', {
    preHandler: [requirePermission('cards', 'manage'), gate],
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Revoke a card (global administration, soft-delete)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['cardId'], properties: { cardId: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { removed: { type: 'boolean' } } }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string };
    const existing = await getCardByIdAny(fastify.db, cardId);
    if (!existing) return reply.status(404).send({ error: 'Card not found' });
    const agreementRef = existing.customerAgreementInstanceReference as string;
    const removed = await revokeCard(fastify.db, agreementRef, cardId);
    if (!removed) return reply.status(404).send({ error: 'Card not found' });
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'card', entityId: cardId,
      processType: 'card_management', processAction: 'card.removed', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, customerAgreementInstanceReference: agreementRef, mandate: 'cancelled' },
      bianServiceDomain: 'Payment Card', bianControlRecordType: 'PaymentCardManagement',
    });
    return reply.send({ removed: true });
  });
}

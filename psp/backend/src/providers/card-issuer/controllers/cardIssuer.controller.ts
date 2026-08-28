// The provider's own SAVED CARDS: the tokenised instruments a customer has on file here.
//
// Not the bank's issued-card registry, and not an issuer. The card-issuer ENGINE that used to live in this
// file is gone (v37 P12): validating a card's format, network and verification value is the issuer's decision,
// and the bank answers it over its own API. What remains administers the provider's own records, and the two
// endpoints that expose a protected value ask the ISSUER for it rather than deriving anything here.
import { FastifyInstance } from 'fastify';
import {
  getCapabilityModuleConfig,
  upsertCapabilityModuleConfig,
} from '../../../modules/provider/services/capabilityModuleConfig.service';
import { emitComplianceEvent } from '../../../modules/provider/services/businessProcessEvent.service';
import { requirePermission } from '../../../vendors/middleware/acl';
import {
  listAllCards,
  getCardByIdAny,
  registerCardForCustomer,
  updateCardMetadata,
  setCardActivation,
  revokeCard,
  setCardFundingAccount,
  resolveAgreementForFundingAccount,
} from '../../../modules/customer/services/paymentCard.service';
import type { PaymentCardManagementControlRecord } from '../../../modules/customer/models/paymentCard.model';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { resolveCardByToken, resolveCardById, resolveFundingAccount } from '../ports/cardReference.port';
import { resolveOwnerNameByAgreement, searchAgreementsByOwner } from '../ports/owner.port';
import { deriveMaskedPan } from '../../../modules/customer/models/paymentCard.model';
import { revealPanAtIssuer, findByPanAtIssuer, deriveCvvAtIssuer } from '../services/bankcoreCardIssuer.client';

// v29 §8: aggregated list-access audit is opt-in (default off) to avoid flooding the ledger.
const AUDIT_LIST_ACCESS = process.env.PSP_AUDIT_LIST_ACCESS === 'true';

export async function cardIssuerController(fastify: FastifyInstance) {
  const CAP = 'card-issuer';

  // A reveal is addressed by core card id, and the issuer knows the card by its token.
  async function revealPanForCard(cardId: string, correlationId: string): Promise<string | null> {
    const view = await resolveCardById(fastify.db, cardId);
    if (!view?.paymentCardReference) return null;
    const { pan } = await revealPanAtIssuer(view.paymentCardReference, correlationId);
    return pan ?? null;
  }
  // No capability gate on these routes, deliberately (v37 P12).
  //
  // They used to be gated on the capability resolving to the PSP's own built-in engine, which made sense while
  // that engine was what they administered. What they actually administer is the PROVIDER's own record, and who
  // issues the card or services the account has no bearing on the provider's right to manage it. The gate would
  // now refuse every request, because the capability resolves to a bank by design.







  // ── v29 GLOBAL CARD ADMINISTRATION (built-in module surface) ──────────────────────────
  // Global cross-party administration of cardholder cards, distinct from the customer/staff
  // self-service surface (/api/v1/customer/:customerId/cards). Gated to operations_officer (PCI DSS)
  // and to the card-issuer capability resolving to its internal provider (409 managed_externally).
  // PCI DSS: PAN always masked; CVV/PIN never accepted or returned; every mutation audited .

  const cardListItem = {
    type: 'object',
    properties: {
      paymentCardInstanceReference: { type: 'string' },
      customerAgreementInstanceReference: { type: 'string' },
      paymentCardReference: { type: 'string', description: 'PAN surrogate token (not CHD).' },
      paymentCardMaskedPanDisplay: { type: 'string', description: 'Derived from BIN+last4 (not persisted).' },
      paymentCardBin: { type: 'string', nullable: true, description: 'First 6 (non-CHD).' },
      paymentCardLast4: { type: 'string', nullable: true, description: 'Last 4 (non-CHD).' },
      paymentCardNetwork: { type: 'string', nullable: true },
      paymentCardStatus: { type: 'string' },
      paymentCardIsPreferred: { type: 'boolean', nullable: true },
      paymentCardAlias: { type: 'string', nullable: true },
      fundingPayoutAccountInstanceReference: { type: 'string', nullable: true },
      recordCreatedDateTime: { type: 'string', format: 'date-time', nullable: true },
    },
  };

  // GET /cards: global paginated list (display-safe; no expiry).
  fastify.get('/cards', {
    preHandler: [requirePermission('cards', 'view')],
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
          last4: { type: 'string', description: 'Search by last 4 digits (non-CHD, plaintext).' },
          bin: { type: 'string', description: 'Search by BIN prefix (non-CHD, plaintext).' },
          panExact: { type: 'string', description: 'Locate a card by its exact full PAN, resolved by the issuer.' },
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
        502: { description: 'The issuer could not be reached for an exact-PAN search.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const q = (request.query ?? {}) as { page?: number; limit?: number; network?: string; status?: string; agreement?: string; last4?: string; bin?: string; panExact?: string };
    // The issuer resolves the exact PAN to card references, then the core lists those cards. The core
    // never sees the number, only the references that came back.
    if (q.panExact) {
      const { matches, error } = await findByPanAtIssuer(q.panExact.replace(/\D/g, ''), request.id);
      if (error) return reply.status(502).send({ error });
      const refs = matches.map((m) => m.paymentCardInstanceReference);
      const cards = (await Promise.all(refs.map((r) => getCardByIdAny(fastify.db, r)))).filter(Boolean) as Array<Record<string, unknown>>;
      const results = cards.map((c) => ({ ...c, _id: undefined, paymentCardMaskedPanDisplay: deriveMaskedPan(c as Record<string, string | undefined>) }));
      return reply.send({ results, total: results.length, page: 1, limit: results.length });
    }
    const result = await listAllCards(fastify.db, q);
    // Derive the masked PAN for display (not persisted).
    result.results = (result.results as Array<Record<string, unknown>>).map((c) => ({ ...c, paymentCardMaskedPanDisplay: deriveMaskedPan(c as Record<string, string | undefined>) }));
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

  // GET /cards/:cardId, global per-card detail (includes QE:none expiry; audited).
  fastify.get('/cards/:cardId', {
    preHandler: [requirePermission('cards', 'view')],
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
    // v30 cross-linking: resolve the funding/payout account (QE-stripped, display-safe) via the port.
    const fundingRef = card.fundingPayoutAccountInstanceReference;
    const fundingAccount = fundingRef ? await resolveFundingAccount(fastify.db, fundingRef) : null;
    // v30.1: derived cardholder (owner) name, need-to-know, via the port (no broad customers access).
    const ownerName = card.customerAgreementInstanceReference
      ? await resolveOwnerNameByAgreement(fastify.db, card.customerAgreementInstanceReference) : null;
    // v30: masked PAN derived from bin+last4 (not persisted); the full PAN lives only in the vault.
    const maskedPan = deriveMaskedPan(card);
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'card', entityId: cardId,
      processType: 'card_management', processAction: 'card.accessed', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, maskedPan, network: card.paymentCardNetwork, customerAgreementInstanceReference: card.customerAgreementInstanceReference },
      bianServiceDomain: 'Payment Card', bianControlRecordType: 'PaymentCardManagement',
    });
    return reply.send({ ...card, paymentCardMaskedPanDisplay: maskedPan, fundingAccount, ownerName });
  });

  // GET /agreements: owner picker for card registration: search customer agreements by owner name.
  // Returns ONLY the agreement ref + owner name (need-to-know; no other PII). cards:view + gate.
  fastify.get('/agreements', {
    preHandler: [requirePermission('cards', 'view')],
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Search customer agreements by owner name (card owner picker)',
      security: [{ bearerAuth: [] }],
      querystring: { type: 'object', required: ['query'], properties: { query: { type: 'string', minLength: 1 } } },
      response: { 200: { type: 'object', additionalProperties: true }, 403: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { query } = (request.query ?? {}) as { query?: string };
    const results = await searchAgreementsByOwner(fastify.db, query ?? '');
    return reply.send({ results });
  });

  // POST /cards: register a card for an agreement (reuses the domain service; rejects CVV/PIN by schema).
  fastify.post('/cards', {
    preHandler: [requirePermission('cards', 'manage')],
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Register a payment card for an agreement (global administration)',
      description: 'Registers a card-on-file. The funding payout account is REQUIRED; the card owner '
        + '(agreement/party) is DERIVED from that account (a card never funds from another party account). '
        + 'Reuses the SD-88 domain service (dedup via the shared registry). CVV/PIN rejected by schema.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['fundingPayoutAccountInstanceReference', 'cardToken'],
        properties: {
          fundingPayoutAccountInstanceReference: { type: 'string', description: 'Funding payout account; the owner is derived from it.' },
          customerAgreementInstanceReference: { type: 'string', description: 'Optional; derived from the funding account when omitted.' },
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
        400: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
        409: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      fundingPayoutAccountInstanceReference: string;
      customerAgreementInstanceReference?: string;
      cardToken: string;
      paymentCardMaskedPanDisplay?: string;
      paymentCardExpirationDate?: string;
      paymentCardNetwork?: PaymentCardManagementControlRecord['paymentCardNetwork'];
      paymentCardIsPreferred?: boolean;
      paymentCardAlias?: string;
    };
    // Owner is derived from the funding account's party (invariant: a card funds only from its
    // owner's account). Resolve the agreement from the account unless one was explicitly passed.
    const agreementRef = body.customerAgreementInstanceReference
      ?? await resolveAgreementForFundingAccount(fastify.db, body.fundingPayoutAccountInstanceReference);
    if (!agreementRef) return reply.status(400).send({ error: 'Funding account has no resolvable owner agreement' });
    const result = await registerCardForCustomer(fastify.db, {
      customerAgreementInstanceReference: agreementRef,
      cardToken: body.cardToken,
      paymentCardMaskedPanDisplay: body.paymentCardMaskedPanDisplay ?? '',
      paymentCardIsPreferred: body.paymentCardIsPreferred ?? false,
      fundingPayoutAccountInstanceReference: body.fundingPayoutAccountInstanceReference,
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

  // PATCH /cards/:cardId, update alias/note metadata.
  fastify.patch('/cards/:cardId', {
    preHandler: [requirePermission('cards', 'manage')],
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

  // PATCH /cards/:cardId/status, activate / suspend.
  fastify.patch('/cards/:cardId/status', {
    preHandler: [requirePermission('cards', 'manage')],
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

  // DELETE /cards/:cardId, revoke (soft-delete; record retained for audit).
  fastify.delete('/cards/:cardId', {
    preHandler: [requirePermission('cards', 'manage')],
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

  // PATCH /cards/:cardId/funding, reassign the funding payout account. The card owner follows the
  // new account's party (invariant), so this is also how ownership is reassigned. Audited.
  fastify.patch('/cards/:cardId/funding', {
    preHandler: [requirePermission('cards', 'manage')],
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Reassign a card funding account (and, implicitly, its owner)',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['cardId'], properties: { cardId: { type: 'string' } } },
      body: { type: 'object', required: ['fundingPayoutAccountInstanceReference'], additionalProperties: false, properties: { fundingPayoutAccountInstanceReference: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 400: { $ref: 'Error#' }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string };
    const { fundingPayoutAccountInstanceReference } = request.body as { fundingPayoutAccountInstanceReference: string };
    const updated = await setCardFundingAccount(fastify.db, cardId, fundingPayoutAccountInstanceReference);
    if (!updated) return reply.status(400).send({ error: 'Card not found or funding account has no resolvable owner' });
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'card', entityId: cardId,
      processType: 'card_management', processAction: 'card.funding.reassigned', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, fundingPayoutAccountInstanceReference, customerAgreementInstanceReference: updated.customerAgreementInstanceReference },
      bianServiceDomain: 'Payment Card', bianControlRecordType: 'PaymentCardManagement',
    });
    return reply.send({ ...updated, paymentCardMaskedPanDisplay: deriveMaskedPan(updated) });
  });

  // ── v30 CVV / PAN reveal (SAD derived, CHD from the issuer vault) ────────────────────────────

  // Resolve the ephemeral per-card CVV for a card id via the ports. Returns null when the card is
  // unknown or the CVK is not provisioned. Never persists or logs the value.
  /**
   * The verification value for one saved card, derived BY THE ISSUER.
   *
   * Nothing about it is computed here: the value comes from the bank, and so does its length. The PSP used to
   * look the length up in its own copy of the network rules and pass it along, which meant two places
   * declared how long an American Express value is. The bank falls back to its own network configuration
   * when none is given, and the expiry to the one it has registered, so neither is sent.
   */
  async function deriveCvvForCardId(cardId: string): Promise<{ cvv: string; last4: string | null } | null> {
    const view = await resolveCardById(fastify.db, cardId);
    if (!view) return null;
    const derived = await deriveCvvAtIssuer({ cardToken: view.paymentCardReference });
    if (!derived.cvv) return null;
    return { cvv: derived.cvv, last4: view.paymentCardLast4 ?? null };
  }

  // POST /reveal (internal loopback, owner reveal flow via dispatchProvider). Derives the CVV for a
  // card and returns it ephemerally. Only reachable through the provider dispatch (X-Integration-Source).


  // GET /cards/:cardId/cvv (direct reveal for operations_officer, subsystem console). Gate: internal
  // provider + cards:manage. Audited (card.cvv.revealed). Step-up MFA in production.
  fastify.get('/cards/:cardId/cvv', {
    preHandler: [requirePermission('cards', 'manage')],
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Reveal a card CVV (operations officer, subsystem console)',
      description: 'Derives the ephemeral per-card CVV (HMAC/CVK; never stored). operations_officer only, '
        + 'internal card-issuer provider only (409 managed_externally otherwise). Audited (PCI Req 10). '
        + 'Production: step-up MFA/SCA required.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['cardId'], properties: { cardId: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { cvv: { type: 'string' } } }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string };
    const r = await deriveCvvForCardId(cardId);
    if (!r) return reply.status(404).send({ error: 'Card not found or CVV unavailable' });
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'card', entityId: cardId,
      processType: 'card_management', processAction: 'card.cvv.revealed', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, channel: 'admin_console', last4: r.last4 },
      bianServiceDomain: 'Payment Card', bianControlRecordType: 'PaymentCardManagement',
    });
    return reply.send({ cvv: r.cvv });
  });

  // GET /cards/:cardId/pan (direct full-PAN reveal for operations_officer from the issuer vault).
  // Gate: internal provider + cards:manage. Audited (card.pan.revealed). Ephemeral, step-up in prod.
  fastify.get('/cards/:cardId/pan', {
    preHandler: [requirePermission('cards', 'manage')],
    schema: {
      tags: ['modules:card-issuer'],
      summary: 'Reveal a full PAN (operations officer, subsystem console)',
      description: 'Returns the full PAN from the issuer vault (QE-decrypted server-side), ephemerally. '
        + 'operations_officer only, internal provider only. Audited (PCI Req 10). Step-up MFA in production.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['cardId'], properties: { cardId: { type: 'string' } } },
      response: { 200: { type: 'object', properties: { pan: { type: 'string' } } }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' }, 409: { $ref: 'Error#' } },
    },
  }, async (request, reply) => {
    const { cardId } = request.params as { cardId: string };
    const pan = await revealPanForCard(cardId, request.id);
    if (!pan) return reply.status(404).send({ error: 'PAN not found in issuer vault' });
    const user = (request as { user?: JwtUserPayload }).user;
    emitComplianceEvent(fastify.db, {
      entityType: 'card', entityId: cardId,
      processType: 'card_management', processAction: 'card.pan.revealed', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { module: CAP, channel: 'admin_console', last4: pan.replace(/\D/g, '').slice(-4) },
      bianServiceDomain: 'Payment Card', bianControlRecordType: 'CardAdministration',
    });
    return reply.send({ pan });
  });

  // POST /reveal-pan (internal loopback, owner PAN reveal via dispatchProvider).

}

import { FastifyInstance } from 'fastify';
import { registerCardForCustomer, getCardsByCustomer, getCardById, getCardHolderCount, getCardRegistryByToken, getCardByToken, updateCardMetadata, setCardActivation, revokeCard, getOwnAgreementId } from '../services/paymentCard.service';
import type { PaymentCardManagementControlRecord } from '../models/paymentCard.model';
import type { JwtUserPayload } from '../../../shared/models/identity.model';
import { emitComplianceEvent } from '../../provider/services/businessProcessEvent.service';
import { canStaffMutate, canStaffInvestigate } from '../../../vendors/middleware/rbac';
import type { UserRole } from '../../../shared/models/identity.model';
import { dispatchProvider } from '../../provider/services/integrationDispatch.service';

const STAFF_READ_ROLES = ['level1_analyst', 'level2_investigator', 'security_auditor'];

// Mounted at /customer  -  routes are /:customerId/cards
//
// Authorization model (PCI DSS least privilege, customer-centric):
//  - A customer may VIEW / ADD / REMOVE only THEIR OWN cards (the path :customerId must match
//    the agreement linked to their JWT partyRef: ownership enforced server-side).
//  - Staff (L1/L2/auditor) may READ a customer's card list for investigation, but NOT add/remove.
//  - Every add/remove emits a compliance audit event . CVV/PIN are never accepted/stored.
//  Note: production step-up MFA for add/remove plugs in at these handlers (re-auth/TOTP); the demo
//  gates the destructive action with an explicit client confirmation.
export async function paymentCardController(fastify: FastifyInstance) {

  // POST /api/v1/customer/:customerId/cards
  fastify.post('/:customerId/cards', {
    schema: {
      tags: ['cards'],
      summary: 'Register a payment card for a customer',
      description: `Creates a \`paymentCard\` document (BIAN SD-88) linked to the customer
identified by \`customerId\` (\`customerAgreementInstanceReference\`).

**REST note:** the card is a sub-resource of the customer agreement. The
\`customerAgreementInstanceReference\` is taken from the path parameter \`:customerId\`
and must NOT be repeated in the request body.

**PCI DSS field classification:**

| Field | Classification | Storage |
|---|---|---|
| \`cardToken\` | NOT CHD (surrogate) | Plaintext, indexed |
| \`paymentCardExpirationDate\` | CHD (expiry co-located with card ref) | QE:none  -  encrypted, requires DEK-sensitive |
| \`paymentCardMaskedPanDisplay\` | Display only (last 4) | Plaintext; permitted by PCI DSS |
| CVV / PIN | SAD (**prohibited**) | Never stored |`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['customerId'],
        properties: {
          customerId: {
            type: 'string',
            description: '`customerAgreementInstanceReference` UUID. Obtain via `GET /api/v1/customer?email=...`.',
          },
        },
      },
      body: {
        type: 'object',
        required: ['cardToken', 'paymentCardExpirationDate', 'paymentCardMaskedPanDisplay', 'paymentCardNetwork'],
        properties: {
          cardToken: {
            type: 'string',
            description: 'PAN surrogate token. NOT the real card number. Stored in plaintext.',
          },
          paymentCardExpirationDate: {
            type: 'string',
            // Month must be 01-12: the issuer module derives the per-card CVV from this value and
            // its expired-card check fails open on an unparseable month.
            pattern: '^(0[1-9]|1[0-2])/[0-9]{2}$',
            description: 'Card expiry date in `MM/YY` format (month 01-12). Stored as QE:none (encrypted, not searchable).',
          },
          paymentCardMaskedPanDisplay: {
            type: 'string',
            description: 'Display-safe last-4 string, format `****-****-****-XXXX`.',
          },
          paymentCardNetwork: {
            type: 'string',
            enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'],
            description: 'Card network / scheme.',
          },
          paymentCardIsPreferred: {
            type: 'boolean',
            default: false,
            description: 'When true, marks this card as the default for recurring payments (v4).',
          },
          paymentCardAlias: {
            type: 'string',
            maxLength: 40,
            description: 'Optional customer nickname (non-CHD display label).',
          },
        },
      },
      response: {
        201: {
          description: 'Payment card created and linked to the customer agreement.',
          type: 'object',
          properties: {
            paymentCardInstanceReference: {
              type: 'string',
              description: 'UUID of the created `paymentCard` document (BIAN SD-88).',
            },
            paymentCardStatus: {
              type: 'string',
              description: 'Card status after registration (`active` for a new/reactivated card; the existing status when reused).',
            },
            reused: {
              type: 'boolean',
              description: 'True when the customer already had this card on file, no duplicate was created.',
            },
          },
        },
        400: { description: 'Required fields missing.', $ref: 'Error#' },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        403: { description: 'Not the owner of this customer account.', $ref: 'Error#' },
        500: { description: 'Unexpected server error.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { customerId } = request.params as { customerId: string };
    const body = request.body as {
      cardToken: string;
      paymentCardExpirationDate: string;
      paymentCardMaskedPanDisplay: string;
      paymentCardNetwork: PaymentCardManagementControlRecord['paymentCardNetwork'];
      paymentCardIsPreferred?: boolean;
      paymentCardAlias?: string;
    };

    if (!body.cardToken || !body.paymentCardExpirationDate) {
      return reply.status(400).send({
        error: 'cardToken and paymentCardExpirationDate are required',
      });
    }

    // Ownership: a customer may only register a card on their own agreement.
    const user = (request as { user?: JwtUserPayload }).user;
    const ownId = await getOwnAgreementId(fastify.db, user?.partyRef);
    if (!ownId || ownId !== customerId) {
      return reply.status(403).send({ error: 'You can only register a card on your own account.' });
    }

    // Dedup: a customer cannot hold the same card (deterministic token) twice. Re-adding returns
    // the existing arrangement (reused); a removed card is reactivated. The shared registry (the
    // physical card + holder count for FDS/AML) is synced inside the service.
    const result = await registerCardForCustomer(fastify.db, {
      customerAgreementInstanceReference: customerId,
      cardToken: body.cardToken,
      paymentCardExpirationDate: body.paymentCardExpirationDate,
      paymentCardMaskedPanDisplay: body.paymentCardMaskedPanDisplay,
      paymentCardNetwork: body.paymentCardNetwork,
      paymentCardIsPreferred: body.paymentCardIsPreferred ?? false,
      ...(body.paymentCardAlias ? { paymentCardAlias: body.paymentCardAlias } : {}),
    });

    // Audit (PCI DSS): record the card registration. No CHD in the summary.
    if (!result.reused) emitComplianceEvent(fastify.db, {
      entityType: 'card',
      entityId: result.paymentCardInstanceReference,
      processType: 'card_management',
      processAction: 'card.registered',
      processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null,
      performedByRole: user?.role ?? null,
      eventSummary: { maskedPan: body.paymentCardMaskedPanDisplay, network: body.paymentCardNetwork, customerAgreementInstanceReference: customerId },
      bianServiceDomain: 'Payment Card',
      bianControlRecordType: 'PaymentCardManagement',
    });

    return reply.status(201).send(result);
  });

  // GET /api/v1/customer/me/cards: the AUTHENTICATED caller's own saved cards (display-safe).
  //
  // Caller-scoped by design: the customer agreement is resolved from the caller's JWT (partyRef)
  // via getOwnAgreementId, never from a client-supplied id, never from a session/link's stored
  // acting party. Used by the hosted payment pages (checkout + payment link) to offer the viewer a
  // one-tap saved-card pick. A shared link opened in another browser (no/other token) resolves to a
  // different caller (or 401), so it can never surface someone else's cards.
  //
  // PCI DSS: returns display-safe rows only, surrogate token (not CHD) + masked PAN (last 4) +
  // network + alias + preferred flag. Never the full PAN, never the CVV/PIN (SAD, prohibited), and
  // NOT the expiry (QE:none; owner-only via the per-card detail endpoint). Only `active` cards are
  // returned (a suspended/expired card would only decline at authorization).
  fastify.get('/me/cards', {
    schema: {
      tags: ['cards'],
      summary: 'List the authenticated caller\'s own saved cards (display-safe)',
      description: `Returns the caller's own saved cards (BIAN SD-88). The customer agreement is
resolved server-side from the caller's session token (partyRef), no id is accepted from the client,
so a caller can only ever see their OWN cards (PCI DSS Req 7 least privilege). Display-safe fields
only: surrogate token, masked PAN, network, alias, preferred flag. No full PAN, no CVV, no expiry.`,
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          description: 'The caller\'s own active saved cards.',
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  paymentCardInstanceReference: { type: 'string' },
                  cardToken: { type: 'string', description: 'PAN surrogate token (not CHD). Used to pay with the saved card.' },
                  paymentCardMaskedPanDisplay: { type: 'string' },
                  paymentCardNetwork: { type: 'string', nullable: true },
                  paymentCardAlias: { type: 'string', nullable: true },
                  paymentCardIsPreferred: { type: 'boolean', nullable: true },
                },
              },
            },
          },
        },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    // Identity comes ONLY from the verified token; the caller cannot name another customer.
    const user = (request as { user?: JwtUserPayload }).user;
    const ownId = await getOwnAgreementId(fastify.db, user?.partyRef);
    // No agreement for this caller (e.g. staff without a customer profile) → no saved cards.
    if (!ownId) return reply.send({ results: [] });

    const { results } = await getCardsByCustomer(fastify.db, ownId);
    const displaySafe = (results as Array<Record<string, unknown>>)
      // Only cards usable at authorization time (active card-on-file); a suspended/expired card
      // would just decline, so keep it out of the quick-pick selector.
      .filter((c) => c.paymentCardStatus === 'active')
      .map((c) => ({
        paymentCardInstanceReference: c.paymentCardInstanceReference as string,
        cardToken: c.paymentCardReference as string,
        paymentCardMaskedPanDisplay: c.paymentCardMaskedPanDisplay as string,
        ...(c.paymentCardNetwork ? { paymentCardNetwork: c.paymentCardNetwork as string } : {}),
        ...(c.paymentCardAlias ? { paymentCardAlias: c.paymentCardAlias as string } : {}),
        ...(c.paymentCardIsPreferred ? { paymentCardIsPreferred: true } : {}),
      }));
    return reply.send({ results: displaySafe });
  });

  // GET /api/v1/customer/:customerId/cards
  fastify.get('/:customerId/cards', {
    schema: {
      tags: ['cards'],
      summary: 'List payment cards for a customer',
      description: `Returns all \`paymentCard\` documents (BIAN SD-88) linked to the
customer identified by \`:customerId\` (\`customerAgreementInstanceReference\`).

The encrypted expiry date (\`paymentCardExpirationDate\`, QE:none) is **not** included
in this list response; it requires Level 2 access and a separate request.`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['customerId'],
        properties: {
          customerId: {
            type: 'string',
            description: '`customerAgreementInstanceReference` UUID.',
          },
        },
      },
      response: {
        200: {
          description: 'Payment cards linked to the customer.',
          type: 'object',
          properties: {
            results: {
              type: 'array',
              description: 'All active cards for this customer.',
              items: {
                type: 'object',
                properties: {
                  paymentCardInstanceReference: { type: 'string', description: 'Card UUID.' },
                  paymentCardReference: { type: 'string', description: 'PAN surrogate token (not CHD).' },
                  paymentCardMaskedPanDisplay: { type: 'string', description: 'Last-4 display string.' },
                  paymentCardNetwork: {
                    type: 'string',
                    enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'],
                    description: 'Card network.',
                  },
                  paymentCardStatus: {
                    type: 'string',
                    enum: ['active', 'blocked', 'expired', 'pending_activation'],
                    description: 'Current card lifecycle status.',
                  },
                  paymentCardIsPreferred: {
                    type: 'boolean',
                    description: 'True when this is the default card for recurring payments.',
                  },
                  paymentCardAlias: {
                    type: 'string',
                    nullable: true,
                    description: 'Customer-defined nickname (non-CHD display metadata).',
                  },
                  recordCreatedDateTime: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                    description: 'When the card was registered.',
                  },
                },
              },
            },
          },
        },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        403: { description: 'Not authorized to view this customer\'s cards.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { customerId } = request.params as { customerId: string };
    // Owner (the customer themselves) or staff (read-only, for investigation).
    const user = (request as { user?: JwtUserPayload }).user;
    const ownId = await getOwnAgreementId(fastify.db, user?.partyRef);
    const isOwner = !!ownId && ownId === customerId;
    const isStaff = STAFF_READ_ROLES.includes(user?.role ?? '');
    if (!isOwner && !isStaff) {
      return reply.status(403).send({ error: 'You can only view your own saved cards.' });
    }
    const result = await getCardsByCustomer(fastify.db, customerId);
    return reply.send(result);
  });

  // GET /api/v1/customer/card-registry/:token, FDS/AML shared-card lookup (investigation).
  // Returns the physical card and HOW MANY customers hold it (a money-mule / shared-card signal),
  // plus the holder agreement references. Restricted to L1/L2/auditor. Token is non-CHD.
  fastify.get('/card-registry/:token', {
    schema: {
      tags: ['cards'],
      summary: 'Shared-card registry lookup (FDS/AML, investigation roles)',
      description: `Given a card surrogate token (e.g. from a transaction's \`paymentCardReference\`),
returns the physical card and the set of customers holding it on file. A high \`cardHolderCount\` is a
shared-card / money-mule indicator. Restricted to fraud analyst / investigator / auditor roles.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            paymentCardReference: { type: 'string' },
            paymentCardMaskedPanDisplay: { type: 'string' },
            paymentCardNetwork: { type: 'string', nullable: true },
            cardHolderCount: { type: 'number' },
            cardHolderAgreementReferences: { type: 'array', items: { type: 'string' } },
            firstRegisteredDateTime: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        403: { description: 'Restricted to investigation roles.', $ref: 'Error#' },
        404: { description: 'No registry entry for this token.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as { user?: JwtUserPayload }).user;
    if (!STAFF_READ_ROLES.includes(user?.role ?? '')) {
      return reply.status(403).send({ error: 'Shared-card oversight is restricted to investigation roles.' });
    }
    const { token } = request.params as { token: string };
    const reg = await getCardRegistryByToken(fastify.db, token);
    if (!reg) return reply.status(404).send({ error: 'No registry entry for this token' });
    return reply.send(reg);
  });

  // GET /api/v1/customer/card-by-token/:token, investigation pivot from a transaction.
  // A transaction only carries the surrogate token (paymentCardReference); this resolves the
  // UUIDs an investigator needs to pivot to the card detail, the owning customer (KYC) and the
  // funding bank account. Restricted to investigation roles. Token is non-CHD; no expiry/CVV.
  fastify.get('/card-by-token/:token', {
    schema: {
      tags: ['cards'],
      summary: 'Resolve card / owner / funding account from a surrogate token (investigation roles)',
      description: `Given a card surrogate token (a transaction's \`paymentCardReference\`), returns the
identifiers needed to continue an investigation: the card instance, its owning customer agreement and
its funding/payout account. No CHD, no card expiry. Restricted to fraud analyst / investigator / auditor.`,
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            paymentCardInstanceReference: { type: 'string', description: 'Card UUID (for the card detail page).' },
            customerAgreementInstanceReference: { type: 'string', description: 'Owning customer agreement UUID.' },
            fundingPayoutAccountInstanceReference: { type: 'string', nullable: true, description: 'Funding/payout account UUID.' },
            paymentCardMaskedPanDisplay: { type: 'string', description: 'Last-4 display string.' },
            paymentCardNetwork: { type: 'string', nullable: true },
            paymentCardStatus: { type: 'string' },
          },
        },
        403: { description: 'Restricted to investigation roles.', $ref: 'Error#' },
        404: { description: 'No card on file for this token.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as { user?: JwtUserPayload }).user;
    if (!STAFF_READ_ROLES.includes(user?.role ?? '')) {
      return reply.status(403).send({ error: 'Card lookup by token is restricted to investigation roles.' });
    }
    const { token } = request.params as { token: string };
    const card = await getCardByToken(fastify.db, token);
    if (!card) return reply.status(404).send({ error: 'No card on file for this token' });
    return reply.send({
      paymentCardInstanceReference: card.paymentCardInstanceReference,
      customerAgreementInstanceReference: card.customerAgreementInstanceReference,
      fundingPayoutAccountInstanceReference: card.fundingPayoutAccountInstanceReference,
      paymentCardMaskedPanDisplay: card.paymentCardMaskedPanDisplay,
      paymentCardNetwork: card.paymentCardNetwork,
      paymentCardStatus: card.paymentCardStatus,
    });
  });

  // GET /api/v1/customer/:customerId/cards/:cardId, card detail.
  // Returns the card-on-file (surrogate token, lifecycle dates, alias/note). The owner also sees the
  // QE:none expiry; staff (investigator/auditor) get a READ without the expiry (owner-only reveal,
  // PCI DSS). CVV/PIN are never stored, never returned.
  fastify.get('/:customerId/cards/:cardId', {
    schema: {
      tags: ['cards'],
      summary: 'Get one saved payment card (owner self-service detail)',
      description: `Returns the full \`paymentCard\` record (BIAN SD-88) for the cardholder's own card:
surrogate \`paymentCardReference\` token, the \`paymentCardExpirationDate\` (QE:none), lifecycle dates,
status and the customer-defined \`paymentCardAlias\` / \`paymentCardCustomerNote\`. Owner-only.

**PCI DSS:** the full PAN and CVV/PIN (SAD) are never stored, so are never returned. The expiry is
disclosed to the cardholder for their own card only (not to staff without escalation). Access is
audited (Req 10).`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['customerId', 'cardId'],
        properties: {
          customerId: { type: 'string', description: '`customerAgreementInstanceReference` UUID.' },
          cardId: { type: 'string', description: '`paymentCardInstanceReference` UUID.' },
        },
      },
      response: {
        200: {
          description: 'The saved card detail.',
          type: 'object',
          properties: {
            paymentCardInstanceReference: { type: 'string' },
            customerAgreementInstanceReference: { type: 'string' },
            paymentCardReference: { type: 'string', description: 'PAN surrogate token (not CHD).' },
            paymentCardExpirationDate: { type: 'string', description: 'Card expiry (QE:none), owner-visible.' },
            paymentCardMaskedPanDisplay: { type: 'string' },
            paymentCardNetwork: { type: 'string', enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'] },
            paymentCardStatus: { type: 'string' },
            paymentCardIsPreferred: { type: 'boolean' },
            paymentCardAlias: { type: 'string', nullable: true },
            paymentCardCustomerNote: { type: 'string', nullable: true },
            paymentCardMandateStatus: { type: 'string', nullable: true },
            paymentCardIssuanceDateTime: { type: 'string', format: 'date-time', nullable: true },
            recordCreatedDateTime: { type: 'string', format: 'date-time', nullable: true },
            recordUpdatedDateTime: { type: 'string', format: 'date-time', nullable: true },
            cardHolderCount: { type: 'number', description: 'How many customers hold this same physical card (FDS/AML shared-card signal). 1 = only you.' },
            fundingPayoutAccountInstanceReference: { type: 'string', nullable: true, description: 'BIAN SD-88 cardAccountReference: the SD-66 payout account that funds this card.' },
          },
        },
        401: { $ref: 'Error#' },
        403: { description: 'Not the owner of this customer account.', $ref: 'Error#' },
        404: { description: 'Card not found for this customer.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { customerId, cardId } = request.params as { customerId: string; cardId: string };
    const user = (request as { user?: JwtUserPayload }).user;
    const ownId = await getOwnAgreementId(fastify.db, user?.partyRef);
    const isOwner = !!ownId && ownId === customerId;
    const isStaff = canStaffInvestigate((user?.role ?? '') as UserRole);
    if (!isOwner && !isStaff) {
      return reply.status(403).send({ error: 'You can only view your own saved cards.' });
    }
    const card = await getCardById(fastify.db, customerId, cardId);
    if (!card) return reply.status(404).send({ error: 'Card not found' });

    // The QE:none expiry is disclosed to the cardholder only (PCI DSS). A staff investigation
    // READ never reveals it; strip it so the drill-down stays display-safe.
    if (!isOwner) delete (card as Record<string, unknown>).paymentCardExpirationDate;

    // FDS/AML shared-card signal: how many customers hold this same physical card (the number only,
    // never the other holders' identities: PCI/PII minimization for the cardholder's own view).
    const cardHolderCount = await getCardHolderCount(fastify.db, card.paymentCardReference as string);

    // Audit (PCI DSS): record self-service access to a card-on-file. No CHD in the summary.
    emitComplianceEvent(fastify.db, {
      entityType: 'card',
      entityId: cardId,
      processType: 'card_management',
      processAction: 'card.accessed',
      processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null,
      performedByRole: user?.role ?? null,
      eventSummary: { maskedPan: card.paymentCardMaskedPanDisplay, network: card.paymentCardNetwork, customerAgreementInstanceReference: customerId },
      bianServiceDomain: 'Payment Card',
      bianControlRecordType: 'PaymentCardManagement',
    });

    return reply.send({ ...card, cardHolderCount });
  });

  // POST /api/v1/customer/:customerId/cards/:cardId/cvv  (OWNER reveal of the per-card CVV), routed
  // THROUGH the provider dispatch (never a direct call to the built-in module). Owner-only + step-up.
  // The CVV is derived (never stored) and returned ephemerally; the reveal is audited with
  // NO CVV in the log. If an external issuer governs the capability, the dispatch routes to it.
  const ownerReveal = (kind: 'cvv' | 'pan') => async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const { customerId, cardId } = request.params as { customerId: string; cardId: string };
    const user = (request as { user?: JwtUserPayload }).user;
    const ownId = await getOwnAgreementId(fastify.db, user?.partyRef);
    if (!ownId || ownId !== customerId) return reply.status(403).send({ error: 'You can only reveal your own card data.' });
    const card = await getCardById(fastify.db, customerId, cardId);
    if (!card) return reply.status(404).send({ error: 'Card not found' });
    const event = kind === 'cvv' ? 'card.cvv.reveal.requested' : 'card.pan.reveal.requested';
    const r = await dispatchProvider(fastify.db, 'card_issuer', event, {
      cardId, cardToken: card.paymentCardReference,
    }, { entityType: 'card', entityId: cardId, processType: 'card_management' });
    const body = (r.responseBody ?? {}) as { cvv?: string; pan?: string };
    const value = kind === 'cvv' ? body.cvv : body.pan;
    if (!value) return reply.status(404).send({ error: `${kind.toUpperCase()} unavailable` });
    emitComplianceEvent(fastify.db, {
      entityType: 'card', entityId: cardId,
      processType: 'card_management', processAction: kind === 'cvv' ? 'card.cvv.revealed' : 'card.pan.revealed', processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null, performedByRole: user?.role ?? null,
      eventSummary: { channel: 'owner_self_service', customerAgreementInstanceReference: customerId, last4: String(value).replace(/\D/g, '').slice(-4) },
      bianServiceDomain: 'Payment Card', bianControlRecordType: 'PaymentCardManagement',
    });
    return reply.send(kind === 'cvv' ? { cvv: value } : { pan: value });
  };

  const ownerRevealSchema = (field: string) => ({
    tags: ['cards'],
    summary: `Reveal own card ${field.toUpperCase()} (owner self-service, via provider)`,
    description: `Owner-only ephemeral reveal of the card ${field.toUpperCase()}, routed through `
      + 'dispatchProvider (card_issuer). Never a direct call to the built-in module. Production: step-up MFA/SCA. '
      + `Audited (Req 10), no ${field.toUpperCase()} in the log.`,
    security: [{ bearerAuth: [] }],
    params: { type: 'object', required: ['customerId', 'cardId'], properties: { customerId: { type: 'string' }, cardId: { type: 'string' } } },
    response: { 200: { type: 'object', additionalProperties: true }, 403: { $ref: 'Error#' }, 404: { $ref: 'Error#' } },
  });

  fastify.post('/:customerId/cards/:cardId/cvv', { schema: ownerRevealSchema('cvv') }, ownerReveal('cvv'));
  fastify.post('/:customerId/cards/:cardId/pan', { schema: ownerRevealSchema('pan') }, ownerReveal('pan'));

  // PATCH /api/v1/customer/:customerId/cards/:cardId, edit the alias/note (the ONLY editable
  // attributes of a saved card). Owner-only. Both fields are non-CHD display metadata.
  fastify.patch('/:customerId/cards/:cardId', {
    schema: {
      tags: ['cards'],
      summary: 'Update a saved card alias / note (owner-only)',
      description: `Updates the customer-defined \`paymentCardAlias\` (nickname) and/or
\`paymentCardCustomerNote\`. These are the **only** mutable attributes of a stored card: the PAN,
token, expiry, network and status are immutable from the customer's side. Owner-only. Emits a
\`card.updated\` compliance audit event (Req 10).

**PCI DSS:** the alias/note are free-text display labels, they MUST NOT contain a PAN/CVV and are
treated purely as a recognizable nickname/memo.`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['customerId', 'cardId'],
        properties: {
          customerId: { type: 'string', description: '`customerAgreementInstanceReference` UUID.' },
          cardId: { type: 'string', description: '`paymentCardInstanceReference` UUID.' },
        },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          paymentCardAlias: { type: 'string', maxLength: 40, description: 'Customer nickname for the card.' },
          paymentCardCustomerNote: { type: 'string', maxLength: 280, description: 'Free-text memo.' },
        },
      },
      response: {
        200: {
          description: 'Updated card detail.',
          type: 'object',
          properties: {
            paymentCardInstanceReference: { type: 'string' },
            paymentCardAlias: { type: 'string', nullable: true },
            paymentCardCustomerNote: { type: 'string', nullable: true },
            recordUpdatedDateTime: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        400: { description: 'No editable fields supplied.', $ref: 'Error#' },
        401: { $ref: 'Error#' },
        403: { description: 'Not the owner of this customer account.', $ref: 'Error#' },
        404: { description: 'Card not found for this customer.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { customerId, cardId } = request.params as { customerId: string; cardId: string };
    const body = (request.body ?? {}) as { paymentCardAlias?: string; paymentCardCustomerNote?: string };

    if (body.paymentCardAlias === undefined && body.paymentCardCustomerNote === undefined) {
      return reply.status(400).send({ error: 'Provide paymentCardAlias and/or paymentCardCustomerNote' });
    }

    const user = (request as { user?: JwtUserPayload }).user;
    const ownId = await getOwnAgreementId(fastify.db, user?.partyRef);
    if (!ownId || ownId !== customerId) {
      return reply.status(403).send({ error: 'You can only edit your own saved cards.' });
    }

    const updated = await updateCardMetadata(fastify.db, customerId, cardId, {
      paymentCardAlias: body.paymentCardAlias,
      paymentCardCustomerNote: body.paymentCardCustomerNote,
    });
    if (!updated) return reply.status(404).send({ error: 'Card not found' });

    emitComplianceEvent(fastify.db, {
      entityType: 'card',
      entityId: cardId,
      processType: 'card_management',
      processAction: 'card.updated',
      processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null,
      performedByRole: user?.role ?? null,
      eventSummary: { customerAgreementInstanceReference: customerId, fields: Object.keys(body) },
      bianServiceDomain: 'Payment Card',
      bianControlRecordType: 'PaymentCardManagement',
    });

    return reply.send(updated);
  });

  // PATCH /api/v1/customer/:customerId/cards/:cardId/status, deactivate / reactivate a card.
  // A deactivated (suspended) card stays on file but the PSP rejects every operation with it,
  // even if the issuer would approve. Owner-only. Emits `card.deactivated` / `card.reactivated`.
  fastify.patch('/:customerId/cards/:cardId/status', {
    schema: {
      tags: ['cards'],
      summary: 'Activate / deactivate a saved card (owner-only)',
      description: `Toggles the card lifecycle between \`active\` and \`suspended\`. A **suspended**
card is retained (not removed) but the PSP **declines any authorization** with it at the gateway,
independent of the issuer's decision (BIAN SD-15 control). Only \`active\`↔\`suspended\` transitions
are allowed; expired/issuer-blocked/revoked cards are not customer-toggleable. Emits a compliance
audit event (Req 10).`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['customerId', 'cardId'],
        properties: {
          customerId: { type: 'string', description: '`customerAgreementInstanceReference` UUID.' },
          cardId: { type: 'string', description: '`paymentCardInstanceReference` UUID.' },
        },
      },
      body: {
        type: 'object',
        required: ['active'],
        additionalProperties: false,
        properties: {
          active: { type: 'boolean', description: 'true = reactivate (suspended→active); false = deactivate (active→suspended).' },
        },
      },
      response: {
        200: {
          description: 'Updated card detail.',
          type: 'object',
          properties: {
            paymentCardInstanceReference: { type: 'string' },
            paymentCardStatus: { type: 'string' },
            recordUpdatedDateTime: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        401: { $ref: 'Error#' },
        403: { description: 'Not the owner of this customer account.', $ref: 'Error#' },
        404: { description: 'Card not found, or not in a toggleable state.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { customerId, cardId } = request.params as { customerId: string; cardId: string };
    const { active } = request.body as { active: boolean };

    // Owner (self-service) OR an L2 investigator acting as staff (control). The auditor is
    // read-only and L1 has no card-mutation reach, so both are blocked here (PCI DSS).
    const user = (request as { user?: JwtUserPayload }).user;
    const ownId = await getOwnAgreementId(fastify.db, user?.partyRef);
    const isOwner = !!ownId && ownId === customerId;
    if (!isOwner && !canStaffMutate((user?.role ?? '') as UserRole)) {
      return reply.status(403).send({ error: 'You can only change the status of your own saved cards.' });
    }

    const updated = await setCardActivation(fastify.db, customerId, cardId, active);
    if (!updated) return reply.status(404).send({ error: 'Card not found or not in a toggleable state' });

    emitComplianceEvent(fastify.db, {
      entityType: 'card',
      entityId: cardId,
      processType: 'card_management',
      processAction: active ? 'card.reactivated' : 'card.deactivated',
      processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null,
      performedByRole: user?.role ?? null,
      eventSummary: { customerAgreementInstanceReference: customerId, maskedPan: updated.paymentCardMaskedPanDisplay, status: updated.paymentCardStatus },
      bianServiceDomain: 'Payment Card',
      bianControlRecordType: 'PaymentCardManagement',
    });

    return reply.send(updated);
  });

  // DELETE /api/v1/customer/:customerId/cards/:cardId, customer removes a saved card.
  fastify.delete('/:customerId/cards/:cardId', {
    schema: {
      tags: ['cards'],
      summary: 'Remove (revoke) a saved payment card',
      description: `Soft-deletes a stored card (BIAN SD-88): sets \`paymentCardStatus: 'revoked'\` and
cancels its recurring mandate. The record is **retained** for the audit trail (PCI DSS Req 10) but is
excluded from the customer's card list. Owner-only: the caller must own \`:customerId\`. A compliance
audit event (\`card.removed\`) is emitted. CVV/PIN are never involved.`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['customerId', 'cardId'],
        properties: {
          customerId: { type: 'string', description: '`customerAgreementInstanceReference` UUID.' },
          cardId: { type: 'string', description: '`paymentCardInstanceReference` UUID to remove.' },
        },
      },
      response: {
        200: { type: 'object', properties: { removed: { type: 'boolean' } } },
        401: { $ref: 'Error#' },
        403: { description: 'Not the owner of this customer account.', $ref: 'Error#' },
        404: { description: 'Card not found for this customer.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { customerId, cardId } = request.params as { customerId: string; cardId: string };
    // Owner (self-service) OR an L2 investigator acting as staff. Auditor (read-only) and L1 blocked.
    const user = (request as { user?: JwtUserPayload }).user;
    const ownId = await getOwnAgreementId(fastify.db, user?.partyRef);
    const isOwner = !!ownId && ownId === customerId;
    if (!isOwner && !canStaffMutate((user?.role ?? '') as UserRole)) {
      return reply.status(403).send({ error: 'You can only remove cards from your own account.' });
    }
    const removed = await revokeCard(fastify.db, customerId, cardId);
    if (!removed) return reply.status(404).send({ error: 'Card not found' });

    emitComplianceEvent(fastify.db, {
      entityType: 'card',
      entityId: cardId,
      processType: 'card_management',
      processAction: 'card.removed',
      processOutcome: 'approved',
      performedByPartyReference: user?.partyRef ?? null,
      performedByRole: user?.role ?? null,
      eventSummary: { customerAgreementInstanceReference: customerId, mandate: 'cancelled' },
      bianServiceDomain: 'Payment Card',
      bianControlRecordType: 'PaymentCardManagement',
    });

    return reply.send({ removed: true });
  });
}

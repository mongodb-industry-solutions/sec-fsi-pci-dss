import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../../vendors/middleware/adminAuth';
import {
  searchIssuedCards, countCardsByStatus, searchAccounts, countAccountsByStatus,
} from '../services/adminSearch.service';
import {
  issueCard, changeCardStatus, renewCard, replaceCard, setCardLimits, findIssuedCard,
} from '../../card-issuer/services/cardLifecycle.service';
import {
  ACCOUNT_ARRANGEMENT_COLLECTION, AccountArrangementControlRecord, AccountStatus,
} from '../../aspsp/models/accountArrangement.model';
import { IssuedCardStatus } from '../../card-issuer/models/cardIssuerVault.model';

// The bank administering its OWN data: the cards it issued and the accounts it holds.
//
// This is the administrative surface, not the Open Banking one. A third party reads an account under a
// consent, scoped to what that consent grants; an operator of this bank administers every account it holds and
// needs filters, a search and a page size to do it. Two audiences, two authorisation models, two surfaces:
// serving the operator through the standard's endpoints would mean either widening a TPP's reach or bending
// the standard, and both are worse than a separate admin API.
const ERROR = {
  type: 'object',
  additionalProperties: true,
  properties: { error: { type: 'string' } },
} as const;

const PAGE_QUERY = {
  page: { type: 'integer', minimum: 1 },
  limit: { type: 'integer', minimum: 1, maximum: 100 },
  q: { type: 'string', description: 'Free text over the non-sensitive identifiers.' },
} as const;

const PAGED_RESPONSE = {
  type: 'object',
  additionalProperties: true,
  properties: {
    results: { type: 'array', items: { type: 'object', additionalProperties: true } },
    total: { type: 'integer' },
    page: { type: 'integer' },
    limit: { type: 'integer' },
    byStatus: { type: 'object', additionalProperties: true },
  },
} as const;

// Which account transitions are legal. `pending_approval` is where an account waits for an operator, which is
// what makes an approval step a real step rather than a button that always succeeds.
const ACCOUNT_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  pending_approval: ['active', 'closed'],
  active: ['blocked', 'closed'],
  blocked: ['active', 'closed'],
  closed: [],
};

export async function bankDataAdminController(fastify: FastifyInstance) {
  // ── Cards ──────────────────────────────────────────────────────────────────────────────────────
  fastify.get('/cards', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'List the cards this bank issued',
      description:
        'Filtered, searched and paged. The free-text search runs over the non-sensitive identifiers only: the '
        + 'surrogate token, the last four, the BIN, the masked display and the holder reference. The card '
        + 'NUMBER is encrypted and is not searchable here at all; the exact-number lookup is its own endpoint '
        + 'on the card surface, behind the cardholder data scope, and it is audited as a disclosure.\\n\\n'
        + 'A BIN is matched as a prefix, because a BIN is a prefix: an operator holding six digits of an '
        + 'eight-digit range still finds the cards.',
      security: [{ adminAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          ...PAGE_QUERY,
          status: { type: 'string', enum: ['issued', 'active', 'suspended', 'revoked'] },
          network: { type: 'string' },
          holder: { type: 'string' },
          last4: { type: 'string' },
          bin: { type: 'string' },
        },
      },
      response: { 200: PAGED_RESPONSE, 401: ERROR, 403: ERROR },
    },
  }, async (request) => {
    const query = request.query as Record<string, string | number>;
    const [page, byStatus] = await Promise.all([
      searchIssuedCards(fastify.db, query as never),
      // Returned with the page so the screen can show the whole estate at a glance without a second call.
      countCardsByStatus(fastify.db),
    ]);
    return { ...page, byStatus };
  });

  fastify.get('/cards/:cardToken', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Read one issued card',
      description: 'The card as the registry holds it: network, BIN, last four, expiry, status and limits. No number.',
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: ERROR, 403: ERROR, 404: ERROR },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const card = await findIssuedCard(fastify.db, cardToken);
    if (!card) return reply.status(404).send({ error: 'No such card at this issuer' });
    return card;
  });

  fastify.post('/cards', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Issue a card',
      description:
        'Mints a card inside one of this bank\'s declared BIN ranges. It lands `issued`, not `active`: a card '
        + 'is activated by whoever receives it, and that gap is the approval step.',
      security: [{ adminAuth: [] }],
      body: {
        type: 'object',
        required: ['network', 'expiryMonth', 'expiryYear'],
        properties: {
          network: { type: 'string' },
          expiryMonth: { type: 'string' },
          expiryYear: { type: 'string' },
          accountHolderReference: { type: 'string' },
          fundingAccountReference: { type: 'string' },
          limits: {
            type: 'object',
            properties: { perTransactionAmount: { type: 'number' }, limitCurrency: { type: 'string' } },
          },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, 400: ERROR, 401: ERROR, 403: ERROR, 409: ERROR },
    },
  }, async (request, reply) => {
    const result = await issueCard(fastify.db, request.body as never);
    if (!result.ok) {
      const status = result.refusal === 'card_token_in_use' ? 409 : 400;
      return reply.status(status).send({ error: result.refusal });
    }
    return reply.status(201).send(result.card);
  });

  fastify.put('/cards/:cardToken/status', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Activate, block or revoke a card',
      description:
        'The lifecycle transition, and the approval step: `issued` to `active` is an operator accepting the '
        + 'card into use. Only legal moves are accepted and `revoked` is terminal, so one token never means '
        + 'two different cards over its history.',
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['issued', 'active', 'suspended', 'revoked'] } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const { status } = request.body as { status: IssuedCardStatus };
    const result = await changeCardStatus(fastify.db, cardToken, status);
    if (!result.ok) {
      if (result.refusal === 'unknown_card') return reply.status(404).send({ error: 'No such card at this issuer' });
      return reply.status(409).send({ error: `A card cannot go from ${result.from} to ${status}` });
    }
    return result.card;
  });

  fastify.put('/cards/:cardToken/limits', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Set the limits an authorisation is judged against',
      description:
        'The per-transaction ceiling this issuer applies. Only a per-transaction one is offered: a daily limit '
        + 'needs a per-card tally of the day\'s authorisations that nothing here keeps, and a limit that '
        + 'silently does nothing would be worse than an absent one.',
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { perTransactionAmount: { type: 'number' }, limitCurrency: { type: 'string' } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: ERROR, 403: ERROR, 404: ERROR },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const result = await setCardLimits(fastify.db, cardToken, request.body as never);
    if (!result.ok) return reply.status(404).send({ error: 'No such card at this issuer' });
    return result.card;
  });

  fastify.post('/cards/:cardToken/renewals', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Renew a card to a later expiry',
      description: 'Same token, same number, later expiry. The verification value changes, since the expiry feeds it.',
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['expiryMonth', 'expiryYear'],
        properties: { expiryMonth: { type: 'string' }, expiryYear: { type: 'string' } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const { expiryMonth, expiryYear } = request.body as { expiryMonth: string; expiryYear: string };
    const result = await renewCard(fastify.db, cardToken, { month: expiryMonth, year: expiryYear });
    if (!result.ok) {
      if (result.refusal === 'unknown_card') return reply.status(404).send({ error: 'No such card at this issuer' });
      return reply.status(409).send({ error: 'A revoked card is replaced, not renewed' });
    }
    return result.card;
  });

  fastify.post('/cards/:cardToken/replacements', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Replace a card, revoking the old one',
      description:
        'A new card with its own token, number and verification value, because a lost card\'s number has to '
        + 'stop working. The replacement is issued BEFORE the old one is revoked, so a failure in between '
        + 'leaves the holder with a working card rather than none.',
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { expiryMonth: { type: 'string' }, expiryYear: { type: 'string' } },
      },
      response: { 201: { type: 'object', additionalProperties: true }, 400: ERROR, 401: ERROR, 403: ERROR, 404: ERROR },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const body = (request.body ?? {}) as { expiryMonth?: string; expiryYear?: string };
    const expiry = body.expiryMonth && body.expiryYear
      ? { month: body.expiryMonth, year: body.expiryYear }
      : undefined;
    const result = await replaceCard(fastify.db, cardToken, expiry);
    if (!result.ok) {
      if (result.refusal === 'unknown_card') return reply.status(404).send({ error: 'No such card at this issuer' });
      return reply.status(400).send({ error: String(result.refusal) });
    }
    return reply.status(201).send({ replacement: result.replacement, replaced: result.replaced });
  });

  // ── Accounts ───────────────────────────────────────────────────────────────────────────────────
  fastify.get('/accounts', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'List the accounts this bank holds',
      description:
        'Filtered, searched and paged, with the holder\'s name resolved per page.\\n\\n'
        + 'The IBAN is encrypted, which shapes what a search can honestly offer: an EXACT IBAN is findable '
        + 'because the field carries an equality index, a partial one is not, and the holder\'s name is not '
        + 'searchable at all because it carries no query index. So free text runs over the masked IBAN, the '
        + 'alias, the BIC and the references. A name search that silently matched nothing would be worse than '
        + 'no name search.\\n\\n'
        + 'The list never returns a full IBAN. A screen that needs one asks for a single account.',
      security: [{ adminAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          ...PAGE_QUERY,
          status: { type: 'string', enum: ['pending_approval', 'active', 'blocked', 'closed'] },
          kind: { type: 'string', enum: ['current', 'savings'] },
          currency: { type: 'string' },
          holder: { type: 'string' },
        },
      },
      response: { 200: PAGED_RESPONSE, 401: ERROR, 403: ERROR },
    },
  }, async (request) => {
    const query = request.query as Record<string, string | number>;
    const [page, byStatus] = await Promise.all([
      searchAccounts(fastify.db, query as never),
      countAccountsByStatus(fastify.db),
    ]);
    return { ...page, byStatus };
  });

  fastify.patch('/accounts/:accountReference/status', {
    preValidation: requireAdmin,
    schema: {
      tags: ['admin'],
      summary: 'Approve, block or close an account',
      description:
        'The approval step: `pending_approval` to `active` is an operator accepting the account into use. '
        + '`closed` is terminal, because reopening a closed account would let one reference mean two '
        + 'relationships over its history.\\n\\n'
        + 'A balance is not touched here. Closing an account with money in it is a refusal, not a silent '
        + 'write-off.',
      security: [{ adminAuth: [] }],
      params: {
        type: 'object',
        required: ['accountReference'],
        properties: { accountReference: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['pending_approval', 'active', 'blocked', 'closed'] },
          reason: { type: 'string', maxLength: 140 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR },
    },
  }, async (request, reply) => {
    const { accountReference } = request.params as { accountReference: string };
    const { status } = request.body as { status: AccountStatus; reason?: string };

    const collection = fastify.db.collection<AccountArrangementControlRecord>(ACCOUNT_ARRANGEMENT_COLLECTION);
    const account = await collection.findOne(
      { accountArrangementInstanceReference: accountReference },
      { projection: { _id: 0, accountStatus: 1, accountBalance: 1 } },
    );
    if (!account) return reply.status(404).send({ error: 'No such account at this bank' });
    if (account.accountStatus === status) return { accountReference, accountStatus: status, unchanged: true };

    const allowed = ACCOUNT_TRANSITIONS[account.accountStatus] ?? [];
    if (!allowed.includes(status)) {
      return reply.status(409).send({ error: `An account cannot go from ${account.accountStatus} to ${status}` });
    }
    // Closing an account holding money would strand it. Refused with the figure, so the operator knows what
    // has to happen first rather than being told only that it failed.
    const available = account.accountBalance?.availableAmount ?? 0;
    if (status === 'closed' && available !== 0) {
      return reply.status(409).send({
        error: `The account still holds ${available.toFixed(2)} ${'' }and cannot be closed until it is empty`,
      });
    }

    await collection.updateOne(
      { accountArrangementInstanceReference: accountReference },
      { $set: { accountStatus: status, recordUpdatedDateTime: new Date().toISOString() } },
    );
    return { accountReference, accountStatus: status };
  });
}

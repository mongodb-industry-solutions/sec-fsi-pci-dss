import { FastifyInstance } from 'fastify';
import { requireStaff } from '../../../vendors/middleware/staffAuth';
import {
  searchIssuedCards, countCardsByStatus, searchAccounts, countAccountsByStatus,
  searchHolders, countHoldersByStatus, MAX_LIMIT, DEFAULT_LIMIT,
} from '../services/adminSearch.service';
import {
  discloseCard, discloseAccountIban, findHolder, discloseHolder, openAccount,
} from '../services/adminDisclosure.service';
import {
  issueCard, changeCardStatus, renewCard, replaceCard, setCardLimits,
} from '../../card-issuer/services/cardLifecycle.service';
import { AccountStatus } from '../../aspsp/models/accountArrangement.model';
import { changeAccountStatus, describeRefusal } from '../services/accountAdmin.service';
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
  // The ceiling and the default come from the service, so there is one page contract rather than two that
  // drift. Every list on this surface answers on it, which is what lets one component drive them all.
  limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
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

export async function bankDataAdminController(fastify: FastifyInstance) {
  // ── Cards ──────────────────────────────────────────────────────────────────────────────────────
  fastify.get('/cards', {
    preValidation: requireStaff('issuedCards', 'view'),
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
          kind: { type: 'string', enum: ['debit', 'credit'] },
          holder: { type: 'string' },
          // The funding account. This is how "the cards on this account" is asked for: the same list with one
          // filter, rather than a second endpoint returning a third shape.
          account: { type: 'string' },
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
    preValidation: requireStaff('issuedCards', 'view'),
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
    const page = await searchIssuedCards(fastify.db, { reference: cardToken, limit: 1 });
    const card = page.results[0];
    if (!card) return reply.status(404).send({ error: 'No such card at this issuer' });
    return card;
  });

  fastify.post('/cards', {
    preValidation: requireStaff('issuedCards', 'manage'),
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
    preValidation: requireStaff('issuedCards', 'manage'),
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
    preValidation: requireStaff('issuedCards', 'manage'),
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
    preValidation: requireStaff('issuedCards', 'manage'),
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
    preValidation: requireStaff('issuedCards', 'manage'),
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
    preValidation: requireStaff('accounts', 'view'),
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
    preValidation: requireStaff('accounts', 'manage'),
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
    const result = await changeAccountStatus(fastify.db, accountReference, status);
    if (!result.ok) {
      return reply.status(result.refusal === 'unknown_account' ? 404 : 409).send({ error: describeRefusal(result) });
    }
    // The `ok` discriminator is the service's, not the API's: a caller reads the status it asked for.
    const { ok, ...state } = result;
    void ok;
    return state;
  });
  // Soft delete, and it is worth being explicit about why it is not a delete. A card that authorised a
  // payment is part of that payment's history: removing the record would leave an authorisation pointing at
  // nothing, and the retention the card rules require would be unmeetable. So the card is revoked, which is
  // terminal, and the row survives for the audit.
  fastify.delete('/cards/:cardToken', {
    preValidation: requireStaff('issuedCards', 'manage'),
    schema: {
      tags: ['admin'],
      summary: 'Withdraw a card from use',
      description:
        'Revokes the card. It is NOT erased: an authorisation already made refers to it, so the record stays '
        + 'and the status becomes terminal. Revoking twice is not an error, it is the state already being '
        + 'what was asked for.',
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      response: { 200: { type: 'object', additionalProperties: true }, 401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const result = await changeCardStatus(fastify.db, cardToken, 'revoked');
    if (!result.ok) {
      if (result.refusal === 'unknown_card') return reply.status(404).send({ error: 'No such card at this issuer' });
      // Already revoked is not a failure: the state is what was asked for.
      if (result.from === 'revoked') return { cardToken, status: 'revoked', unchanged: true };
      return reply.status(409).send({ error: `A card cannot go from ${result.from} to revoked` });
    }
    return result.card;
  });

  // ── Disclosures: the values that are encrypted at rest ─────────────────────────────────────────
  //
  // Each is a POST, because each is an ACT rather than a read: something authorised and recorded, not a field
  // that arrives with a detail response. That shape is what stops a list of a hundred accounts decrypting a
  // hundred IBANs, and it puts one audit row against one act rather than one against "opened a page".
  fastify.post('/cards/:cardToken/disclosures', {
    preValidation: requireStaff('cardData', 'viewSensitive'),
    schema: {
      tags: ['admin'],
      summary: 'Reveal a card\'s protected values',
      description:
        'The card number, the verification value, the expiry and the service code, for ONE card.\n\n'
        + 'The verification value is not stored anywhere and never has been: it is recomputed from the card '
        + 'data plus the issuer key, the way an issuer host does inside an HSM, so revealing it is deriving '
        + 'it. The number is read from the vault, the only place on this platform a full card number exists.'
        + '\n\nThe response is ephemeral. It is not to be persisted or logged by the caller.',
      security: [{ adminAuth: [] }],
      params: { type: 'object', required: ['cardToken'], properties: { cardToken: { type: 'string' } } },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            cardToken: { type: 'string' },
            cardNumber: { type: 'string' },
            verificationValue: { type: 'string' },
            expiry: { type: 'string' },
            serviceCode: { type: 'string' },
            error: {
              type: 'string',
              description: 'Why a value is missing, so a blank is never ambiguous.',
            },
          },
        },
        401: ERROR, 403: ERROR, 404: ERROR,
      },
    },
  }, async (request, reply) => {
    const { cardToken } = request.params as { cardToken: string };
    const disclosure = await discloseCard(fastify.db, cardToken);
    if (!disclosure) return reply.status(404).send({ error: 'No such card at this issuer' });
    return disclosure;
  });

  fastify.post('/accounts/:accountReference/disclosures', {
    preValidation: requireStaff('accounts', 'viewSensitive'),
    schema: {
      tags: ['admin'],
      summary: 'Reveal an account\'s full IBAN',
      description:
        'The IBAN in full, for ONE account. It is personal data rather than cardholder data, which is why it '
        + 'is encrypted and why it is asked for one account at a time instead of arriving with a list.',
      security: [{ adminAuth: [] }],
      params: {
        type: 'object',
        required: ['accountReference'],
        properties: { accountReference: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            accountReference: { type: 'string' },
            iban: { type: 'string' },
            bic: { type: 'string' },
          },
        },
        401: ERROR, 403: ERROR, 404: ERROR,
      },
    },
  }, async (request, reply) => {
    const { accountReference } = request.params as { accountReference: string };
    const disclosure = await discloseAccountIban(fastify.db, accountReference);
    if (!disclosure) return reply.status(404).send({ error: 'No such account at this bank' });
    return disclosure;
  });

  // ── Accounts, one at a time ────────────────────────────────────────────────────────────────────
  fastify.get('/accounts/:accountReference', {
    preValidation: requireStaff('accounts', 'view'),
    schema: {
      tags: ['admin'],
      summary: 'Read one account',
      description:
        'The account as the bank holds it, with the masked IBAN and the masked holder name. Neither full '
        + 'value arrives here: both are encrypted, and both are their own disclosure.',
      security: [{ adminAuth: [] }],
      params: {
        type: 'object',
        required: ['accountReference'],
        properties: { accountReference: { type: 'string' } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: ERROR, 403: ERROR, 404: ERROR },
    },
  }, async (request, reply) => {
    const { accountReference } = request.params as { accountReference: string };
    // Read through the same search the list uses, so one account and a page of accounts cannot describe the
    // same record differently.
    const page = await searchAccounts(fastify.db, { reference: accountReference, limit: 1 });
    const account = page.results[0];
    if (!account) return reply.status(404).send({ error: 'No such account at this bank' });
    return account;
  });

  fastify.post('/accounts', {
    preValidation: requireStaff('accounts', 'manage'),
    schema: {
      tags: ['admin'],
      summary: 'Open an account',
      description:
        'Opens an account with an IBAN this bank can actually claim: built from its own declared bank code '
        + 'with a mod-97 check digit, so the account is routable back to it.\n\n'
        + 'It lands `pending_approval`, never active. Opening and approving are two acts, and collapsing them '
        + 'would make the approval step decorative.\n\n'
        + 'The IBAN is not echoed back. It is a disclosure, and the caller asks for it as one.',
      security: [{ adminAuth: [] }],
      body: {
        type: 'object',
        required: ['accountHolderReference', 'accountKind', 'accountCurrency', 'accountCountryCode'],
        properties: {
          accountHolderReference: { type: 'string' },
          accountKind: { type: 'string', enum: ['current', 'savings'] },
          accountCurrency: { type: 'string', minLength: 3, maxLength: 3 },
          accountCountryCode: { type: 'string', minLength: 2, maxLength: 2 },
          accountAlias: { type: 'string', maxLength: 60 },
        },
      },
      response: {
        201: { type: 'object', additionalProperties: true }, 400: ERROR, 401: ERROR, 403: ERROR, 404: ERROR,
      },
    },
  }, async (request, reply) => {
    const result = await openAccount(fastify.db, request.body as never);
    if (!result.ok) {
      const status = result.refusal === 'unknown_holder' ? 404 : 400;
      return reply.status(status).send({ error: result.refusal });
    }
    const { accountIban, ...safe } = result.account;
    return reply.status(201).send(safe);
  });

  // Closing an account is the delete, and closing is terminal. The record survives because the payments that
  // settled to it refer to it, and a statement that cannot name its own account is not a statement.
  fastify.delete('/accounts/:accountReference', {
    preValidation: requireStaff('accounts', 'manage'),
    schema: {
      tags: ['admin'],
      summary: 'Close an account',
      description:
        'Closes the account. It is NOT erased: settled payments refer to it, so the record stays and the '
        + 'status becomes terminal. An account still holding money is refused, with the figure, because '
        + 'closing it would strand the funds.',
      security: [{ adminAuth: [] }],
      params: {
        type: 'object',
        required: ['accountReference'],
        properties: { accountReference: { type: 'string' } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR },
    },
  }, async (request, reply) => {
    const { accountReference } = request.params as { accountReference: string };
    const result = await changeAccountStatus(fastify.db, accountReference, 'closed');
    if (!result.ok) {
      return reply.status(result.refusal === 'unknown_account' ? 404 : 409).send({ error: describeRefusal(result) });
    }
    const { ok, ...state } = result;
    void ok;
    return state;
  });

  // ── The holder behind an account and a card ────────────────────────────────────────────────────
  fastify.get('/holders', {
    preValidation: requireStaff('accountHolders', 'view'),
    schema: {
      tags: ['admin'],
      summary: 'List account holders, masked',
      description:
        'Enough to choose an owner when opening an account or issuing a card. Masked, and searchable by '
        + 'reference and country only: the name carries no query index, so a name search would silently match '
        + 'nothing.',
      security: [{ adminAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          ...PAGE_QUERY,
          status: { type: 'string', enum: ['active', 'dormant', 'closed'] },
          country: { type: 'string', minLength: 2, maxLength: 2 },
        },
      },
      response: { 200: PAGED_RESPONSE, 401: ERROR, 403: ERROR },
    },
  }, async (request) => {
    const query = request.query as Record<string, string | number>;
    const [page, byStatus] = await Promise.all([
      searchHolders(fastify.db, query as never),
      countHoldersByStatus(fastify.db),
    ]);
    return { ...page, byStatus };
  });

  fastify.get('/holders/:holderReference', {
    preValidation: requireStaff('accountHolders', 'view'),
    schema: {
      tags: ['admin'],
      summary: 'Read an account holder, masked',
      description:
        'The owner behind an account or a card. The name and the contact are both encrypted at rest, so both '
        + 'arrive MASKED: enough to recognise a record you already know, not enough to learn one you do not. '
        + 'The full values are a disclosure of their own.',
      security: [{ adminAuth: [] }],
      params: {
        type: 'object',
        required: ['holderReference'],
        properties: { holderReference: { type: 'string' } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: ERROR, 403: ERROR, 404: ERROR },
    },
  }, async (request, reply) => {
    const { holderReference } = request.params as { holderReference: string };
    const holder = await findHolder(fastify.db, holderReference);
    if (!holder) return reply.status(404).send({ error: 'No such account holder at this bank' });
    return holder;
  });

  fastify.post('/holders/:holderReference/disclosures', {
    preValidation: requireStaff('accountHolders', 'viewSensitive'),
    schema: {
      tags: ['admin'],
      summary: 'Reveal an account holder\'s name and contact',
      description: 'The values behind the mask. Personal data, so it is its own recorded act.',
      security: [{ adminAuth: [] }],
      params: {
        type: 'object',
        required: ['holderReference'],
        properties: { holderReference: { type: 'string' } },
      },
      response: { 200: { type: 'object', additionalProperties: true }, 401: ERROR, 403: ERROR, 404: ERROR },
    },
  }, async (request, reply) => {
    const { holderReference } = request.params as { holderReference: string };
    const disclosure = await discloseHolder(fastify.db, holderReference);
    if (!disclosure) return reply.status(404).send({ error: 'No such account holder at this bank' });
    return disclosure;
  });
}

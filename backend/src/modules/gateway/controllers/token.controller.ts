// BIAN SD-57: Card Etoken  -  Token Vault  -  REST controller
// Routes mounted at /gateway/tokens → /api/v1/gateway/tokens

import { FastifyInstance } from 'fastify';
import { createToken, getToken } from '../services/tokenization.service';

export async function tokenController(fastify: FastifyInstance) {

  // POST /api/v1/gateway/tokens
  fastify.post('/', {
    schema: {
      tags: ['gateway'],
      summary: 'Tokenize a card instrument (SD-57)',
      description: `Creates a \`tokenVault\` entry (BIAN SD-57) that assigns a \`tokenVaultCardToken\`
(format \`tok_<uuid>\`) to a payment card. The token is a card surrogate; it is NOT CHD under PCI DSS v4.0.

**Network tokens:** If the card scheme provides a network token (\`tokenVaultNetworkToken\`), it is stored as QE:none  -  encrypted at rest, never returned in any response.

**PCI DSS:** This endpoint does NOT accept the real PAN. The client generates the token (or the card scheme provides it); the vault stores the association. Full PAN is never stored.

**v5 note:** Prototype returns stub data. Full v5 persists to \`tokenVault\` collection with QE:none on \`tokenVaultNetworkToken\`.`,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['customerAgreementInstanceReference', 'maskedPanDisplay', 'cardNetwork'],
        properties: {
          customerAgreementInstanceReference: { type: 'string', description: 'UUID of the customer who owns this card.' },
          maskedPanDisplay: { type: 'string', description: 'Display-safe last-4 string (****-****-****-XXXX).' },
          cardNetwork: { type: 'string', enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'], description: 'Card network / scheme.' },
          linkedPaymentCardInstanceReference: { type: 'string', description: 'Optional FK to an existing `paymentCard` document (SD-88).' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            tokenVaultInstanceReference: { type: 'string', description: 'UUID of the token vault record.' },
            tokenVaultCardToken: { type: 'string', description: 'Card surrogate token (tok_<uuid>). Use in /api/v1/transactions.' },
            tokenVaultMaskedPanDisplay: { type: 'string' },
            tokenVaultCardNetwork: { type: 'string', enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'] },
            tokenVaultStatus: { type: 'string', enum: ['active', 'suspended', 'expired'] },
            tokenVaultCreatedAt: { type: 'string', format: 'date-time' },
          },
        },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      customerAgreementInstanceReference: string;
      maskedPanDisplay: string;
      cardNetwork: 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO';
      linkedPaymentCardInstanceReference?: string;
    };

    if (!body.customerAgreementInstanceReference || !body.maskedPanDisplay || !body.cardNetwork) {
      return reply.status(400).send({ error: 'customerAgreementInstanceReference, maskedPanDisplay, and cardNetwork are required' });
    }

    const result = await createToken(body);
    return reply.status(201).send(result);
  });

  // GET /api/v1/gateway/tokens/:token
  fastify.get('/:token', {
    schema: {
      tags: ['gateway'],
      summary: 'Get token vault metadata (SD-57)',
      description: `Returns metadata for a card token. The \`tokenVaultNetworkToken\` (QE:none) is **never** returned.

Use this endpoint to verify a token is still \`active\` before initiating a recurring payment.`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string', description: '`tokenVaultCardToken` value (tok_<uuid>).' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            tokenVaultCardToken: { type: 'string' },
            tokenVaultMaskedPanDisplay: { type: 'string' },
            tokenVaultCardNetwork: { type: 'string', enum: ['VISA', 'MASTERCARD', 'AMEX', 'ELO'] },
            tokenVaultStatus: { type: 'string', enum: ['active', 'suspended', 'expired'] },
            tokenVaultCreatedAt: { type: 'string', format: 'date-time' },
            tokenVaultLastUsedAt: { type: 'string', format: 'date-time' },
          },
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const result = await getToken(token);
    if (!result) return reply.status(404).send({ error: 'Token not found' });
    return reply.send(result);
  });
}

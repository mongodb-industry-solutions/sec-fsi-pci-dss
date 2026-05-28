import { FastifyInstance } from 'fastify';
import { getRawClient } from '../vendors/encryption/rawClient';

// Raw document endpoint: only available in non-production environments
export async function demoController(fastify: FastifyInstance) {
  fastify.get('/raw-document/:collection/:id', {
    schema: {
      tags: ['demo'],
      summary: 'Fetch a raw (undecrypted) document from MongoDB',
      description: `**Non-production only.** Returns the raw MongoDB document exactly as
stored on Atlas, bypassing QE decryption. QE-protected fields appear as BSON binary
ciphertext, demonstrating that Atlas stores only opaque bytes and cannot read
the protected values.

This endpoint is the core of the **"What does Atlas see?"** demo step.
It is blocked (\`403 Forbidden\`) in production builds.

**Allowed collections:**
\`cardTransaction\`, \`cardTransactionSensitive\`, \`customerAgreement\`,
\`customerAgreementSensitive\`, \`paymentCard\`, \`partyAuthentication\`,
\`fraudDiagnosisCase\``,
      'x-internal': true,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['collection', 'id'],
        properties: {
          collection: {
            type: 'string',
            enum: [
              'cardTransaction',
              'cardTransactionSensitive',
              'customerAgreement',
              'customerAgreementSensitive',
              'paymentCard',
              'partyAuthentication',
              'fraudDiagnosisCase',
            ],
            description: 'Collection name',
          },
          id: {
            type: 'string',
            description: 'Document identifier (any *InstanceReference UUID)',
          },
        },
      },
      response: {
        200: {
          description: 'Raw document as stored in Atlas (QE fields appear as ciphertext)',
          type: 'object',
          properties: {
            collection: { type: 'string' },
            document: {
              type: 'object',
              description: 'The raw MongoDB document. QE:equality and QE:none fields are binary ciphertext.',
              additionalProperties: true,
            },
          },
        },
        400: { $ref: '#/components/schemas/Error' },
        401: { $ref: '#/components/schemas/Error' },
        403: { $ref: '#/components/schemas/Error' },
        404: { $ref: '#/components/schemas/Error' },
        500: { $ref: '#/components/schemas/Error' },
      },
    },
  }, async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(403).send({ error: 'Not available in production' });
    }

    const { collection, id } = request.params as { collection: string; id: string };

    const allowedCollections = new Set([
      'cardTransaction',
      'cardTransactionSensitive',
      'customerAgreement',
      'customerAgreementSensitive',
      'paymentCard',
      'partyAuthentication',
      'fraudDiagnosisCase',
    ]);

    if (!allowedCollections.has(collection)) {
      return reply.status(400).send({ error: 'Unknown collection' });
    }

    try {
      const rawClient = await getRawClient();
      const db = rawClient.db(process.env.MONGODB_DB_NAME!);
      const doc = await db.collection(collection).findOne({
        $or: [
          { cardTransactionInstanceReference: id },
          { customerAgreementInstanceReference: id },
          { paymentCardInstanceReference: id },
          { fraudDiagnosisInstanceReference: id },
          { partyAuthenticationInstanceReference: id },
        ],
      });

      if (!doc) return reply.status(404).send({ error: 'Document not found' });

      return reply.send({ collection, document: doc });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch raw document' });
    }
  });
}

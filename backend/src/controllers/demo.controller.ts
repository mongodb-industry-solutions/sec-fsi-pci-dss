import { FastifyInstance } from 'fastify';
import { getRawClient } from '../vendors/encryption/rawClient';

// Raw document endpoint: only available in non-production environments
export async function demoController(fastify: FastifyInstance) {
  fastify.get('/raw-document/:collection/:id', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(403).send({ error: 'Not available in production' });
    }

    const { collection, id } = request.params as { collection: string; id: string };

    const allowedCollections = new Set([
      'cardTransactionQE',
      'cardTransactionSensitiveQE',
      'customerAgreementQE',
      'customerAgreementSensitiveQE',
      'paymentCardQE',
      'partyAuthenticationQE',
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

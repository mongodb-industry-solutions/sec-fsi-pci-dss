import { FastifyInstance } from 'fastify';
import { getByEmail, getByPhone, getByAccountRef } from '../services/customerAgreement.service';

export async function customerAgreementController(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      tags: ['customer-agreements'],
      summary: 'Search customer agreement by PII key',
      description: `Searches the Customer Agreement (BIAN SD-53) by exactly one of:
**email**, **phone**, or **accountRef**.

All three search fields are encrypted with **QE:equality** — the encrypted value is sent
to Atlas for comparison, and only the matching ciphertext document is returned. The
plaintext is decrypted client-side in the API process.

**Role behaviour:**
- \`level1_analyst\` and \`level2_investigator\` receive the full agreement record.
- \`level2_investigator\` additionally triggers a read of \`customerAgreementSensitive\`
  (residential address, government ID, risk notes) using the DEK-sensitive key.
- \`customer\` role may only retrieve their own record.`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'Customer email address (QE:equality search)',
            example: 'luis.fernandez@leafybank.demo',
          },
          phone: {
            type: 'string',
            description: 'Customer mobile phone number (QE:equality search)',
            example: '+44 7911 123456',
          },
          accountRef: {
            type: 'string',
            description: 'Bank account reference — BIAN customerAgreementReference (QE:equality search)',
            example: 'ACC-001',
          },
        },
      },
      response: {
        200: {
          description: 'Customer agreement record',
          type: 'object',
          properties: {
            customerAgreementInstanceReference: { type: 'string', description: 'UUID — BIAN Customer Agreement Control Record identifier' },
            customerName: { type: 'string', example: 'Luis Fernandez' },
            customerSegment: { type: 'string', enum: ['retail', 'premium', 'corporate', 'sme'] },
            customerAgreementStatus: { type: 'string', enum: ['active', 'suspended', 'closed'] },
            customerAgreementEnrollmentDate: { type: 'string', format: 'date-time' },
            customerAgreementPreferredLanguage: { type: 'string', example: 'en' },
            sensitive: {
              type: 'object',
              description: 'Present only for level2_investigator role (requires DEK-sensitive)',
              properties: {
                customerAgreementResidentialAddress: {
                  type: 'object',
                  properties: {
                    streetAddress: { type: 'string' },
                    city: { type: 'string' },
                    postalCode: { type: 'string' },
                    countryCode: { type: 'string', example: 'GB' },
                  },
                },
                governmentIdentificationReference: { type: 'string', description: 'National ID or passport reference (QE:none)' },
                customerAgreementRiskNotes: { type: 'string', description: 'Internal analyst notes (QE:none)' },
              },
            },
          },
        },
        400: { $ref: '#/components/schemas/Error' },
        401: { $ref: '#/components/schemas/Error' },
        404: { $ref: '#/components/schemas/Error' },
      },
    },
  }, async (request, reply) => {
    const { email, phone, accountRef } = request.query as {
      email?: string;
      phone?: string;
      accountRef?: string;
    };

    if (email) {
      const result = await getByEmail(fastify.db, email);
      if (!result) return reply.status(404).send({ error: 'Customer agreement not found' });
      return reply.send(result);
    }

    if (phone) {
      const result = await getByPhone(fastify.db, phone);
      if (!result) return reply.status(404).send({ error: 'Customer agreement not found' });
      return reply.send(result);
    }

    if (accountRef) {
      const result = await getByAccountRef(fastify.db, accountRef);
      if (!result) return reply.status(404).send({ error: 'Customer agreement not found' });
      return reply.send(result);
    }

    return reply.status(400).send({ error: 'Provide email, phone, or accountRef query parameter' });
  });
}

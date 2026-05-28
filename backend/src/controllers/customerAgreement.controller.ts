import { FastifyInstance } from 'fastify';
import { getByEmail, getByPhone, getByAccountRef } from '../services/customerAgreement.service';

export async function customerAgreementController(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      tags: ['customer-agreements'],
      summary: 'Search customer agreement by PII key',
      description: `Looks up a \`customerAgreement\` document (BIAN SD-53) by **exactly one**
search key: \`email\`, \`phone\`, or \`accountRef\`. Omitting all three returns 400.

**QE:equality search — how it works:**
All three keys are stored as QE:equality-encrypted fields in Atlas. The API driver
encrypts the search value locally, sends the ciphertext to Atlas for comparison, and
receives the matching encrypted document. Decryption happens in the API process memory —
Atlas never sees the plaintext PII.

**Role-based data visibility:**

| Role | Base record | Sensitive fields |
|---|---|---|
| \`customer\` | Own record only | No |
| \`level1_analyst\` | Any customer | No |
| \`level2_investigator\` | Any customer | Yes (address, govt ID, risk notes) |
| \`security_auditor\` | Any customer (read-only) | Yes |

Sensitive fields (\`customerAgreementResidentialAddress\`, \`governmentIdentificationReference\`,
\`customerAgreementRiskNotes\`) are stored in the \`customerAgreementSensitive\` collection
with a separate DEK (Data Encryption Key) as QE:none. They are returned only when the
caller has the DEK-sensitive key — i.e. \`level2_investigator\` role.`,
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'Customer email address. Maps to `customerEmailAddress` (QE:equality). Provide exactly one of email, phone, or accountRef.',
          },
          phone: {
            type: 'string',
            description: 'Customer mobile phone number. Maps to `customerMobilePhoneNumber` (QE:equality). E.164 or local format accepted.',
          },
          accountRef: {
            type: 'string',
            description: 'Bank account reference. Maps to `customerAgreementReference` (QE:equality). Format: `ACC-NNN`.',
          },
        },
      },
      response: {
        200: {
          description: 'Customer agreement found. The `sensitive` block is present only for `level2_investigator` and `security_auditor` roles.',
          type: 'object',
          properties: {
            customerAgreementInstanceReference: {
              type: 'string',
              description: 'Primary key UUID of the `customerAgreement` document. Use this to query linked payment cards (`GET /api/v1/payment-cards?customerRef=<value>`).',
            },
            customerName: {
              type: 'string',
              description: 'Customer full name (plaintext in v1, QE:equality in v2).',
            },
            customerSegment: {
              type: 'string',
              enum: ['retail', 'premium', 'corporate', 'sme'],
              description: 'Customer risk and product segment.',
            },
            customerAgreementStatus: {
              type: 'string',
              enum: ['active', 'suspended', 'closed'],
              description: 'Current agreement lifecycle status.',
            },
            customerAgreementEnrollmentDate: {
              type: 'string',
              format: 'date-time',
              description: 'Date the customer enrolled with the bank.',
            },
            customerAgreementPreferredLanguage: {
              type: 'string',
              description: 'ISO 639-1 language code for communications.',
            },
            sensitive: {
              type: 'object',
              description: 'High-sensitivity PII. Returned only for `level2_investigator` and `security_auditor` roles. Fields are QE:none — encrypted at rest, not searchable.',
              properties: {
                customerAgreementResidentialAddress: {
                  type: 'object',
                  description: 'Full residential address.',
                  properties: {
                    streetAddress: { type: 'string' },
                    city: { type: 'string' },
                    postalCode: { type: 'string' },
                    countryCode: { type: 'string', description: 'ISO 3166-1 alpha-2.' },
                  },
                },
                governmentIdentificationReference: {
                  type: 'string',
                  description: 'National ID or passport reference. QE:none — requires DEK-sensitive to decrypt.',
                },
                customerAgreementRiskNotes: {
                  type: 'string',
                  description: 'Internal analyst risk notes. QE:none — never exposed to Level 1.',
                },
              },
            },
          },
        },
        400: { description: 'No search key provided, or multiple keys provided.', $ref: 'Error#' },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        404: { description: 'No customer agreement found matching the search key.', $ref: 'Error#' },
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

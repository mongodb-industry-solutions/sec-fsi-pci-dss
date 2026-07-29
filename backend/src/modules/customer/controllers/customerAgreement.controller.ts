import { FastifyInstance } from 'fastify';
import { getByEmail, getByPhone, getByAccountRef, getByInstanceReference, getKycSearchRegistry, searchKyc, canRunKycSearch } from '../services/customerAgreement.service';
import type { AuthenticatedRequest, JwtUserPayload } from '../../../shared/models/identity.model';

// Acting user (unique id + name) from the JWT — recorded in the sensitive-access audit event
// so the case activity log identifies the individual, not just the role (PCI DSS Req 10.2.1).
function actorOf(request: unknown): { ref?: string; name?: string } {
  const u = (request as { user?: JwtUserPayload }).user;
  return { ref: u?.partyRef ?? u?.sub, name: u?.name };
}

export async function customerAgreementController(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      tags: ['customer'],
      summary: 'Search customer agreement by PII key',
      description: `Looks up a \`customerAgreement\` document (BIAN SD-53) by **exactly one**
search key: \`email\`, \`phone\`, or \`accountRef\`. Omitting all three returns 400.

**QE:equality search: how it works:**
All three keys are stored as QE:equality-encrypted fields in Atlas. The API driver
encrypts the search value locally, sends the ciphertext to Atlas for comparison, and
receives the matching encrypted document. Decryption happens in the API process memory;
Atlas never sees the plaintext PII.

**Role-based data visibility:**

| Role | Base record | Sensitive fields |
|---|---|---|
| \`customer\` | Own record only | No |
| \`level1_analyst\` | Any customer | No |
| \`level2_investigator\` | Any customer | Yes (address, govt ID, risk notes) |
| \`security_auditor\` | Any customer (read-only) | Yes |

The identity document (\`customerAgreementGovernmentID\`: type, number, issuing country, expiry) and
\`customerAgreementTaxIDNumber\` are LOOKUP tier (QE:suffix / QE:equality / QE:range / QE:prefix) and are
returned to every role that can reach the record, so a displayed value is always a searchable value (v32).

Sensitive fields (\`customerAgreementResidentialAddress\`, \`customerAgreementRiskNotes\`) are QE:none with a
separate DEK, stored inline on the agreement document since v2. They travel in the response only on the
audited escalation path (a case reference); otherwise the caller receives \`sensitiveAvailable: true\` and must
use the reveal endpoint, which emits one compliance event per disclosure (PCI DSS Req 10.2.2).`,
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
          description: 'Customer agreement found. The `sensitive` block is present only for `level2_investigator` and `security_auditor` roles, and only on the audited escalation path (a case reference); otherwise `sensitiveAvailable: true` signals that the reveal endpoint must be used.',
          type: 'object',
          // v32 B1: the serializer drops any property not listed, so an under-specified schema
          // silently strips fields the projection returns (this route was already losing
          // partyInstanceReference, customerAgreementReference and contactPiiRestricted). The
          // projection in buildResponse() is the contract; documented properties are illustrative.
          additionalProperties: true,
          properties: {
            customerAgreementInstanceReference: {
              type: 'string',
              description: 'Primary key UUID of the `customerAgreement` document. Use this to query linked payment cards (`GET /api/v1/customer/:customerId/cards`).',
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
              description: 'High-sensitivity PII. Returned only for `level2_investigator` and `security_auditor` roles. Fields are QE:none; encrypted at rest, not searchable.',
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
                customerAgreementRiskNotes: {
                  type: 'string',
                  description: 'Internal analyst risk notes. QE:none; never exposed to Level 1.',
                },
              },
            },
          },
        },
        400: { description: 'No search key provided, or multiple keys provided.', $ref: 'Error#' },
        401: { description: 'Missing or invalid Bearer token.', $ref: 'Error#' },
        403: { description: 'Level 2 access requires a valid X-Escalation-Token header.', $ref: 'Error#' },
        404: { description: 'No customer agreement found matching the search key.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { email, phone, accountRef } = request.query as {
      email?: string;
      phone?: string;
      accountRef?: string;
    };
    const { userRole, escalationToken } = request as unknown as AuthenticatedRequest;

    try {
      if (email) {
        const result = await getByEmail(fastify.db, email, userRole, escalationToken, actorOf(request));
        if (!result) return reply.status(404).send({ error: 'Customer agreement not found' });
        return reply.send(result);
      }

      if (phone) {
        const result = await getByPhone(fastify.db, phone, userRole, escalationToken, actorOf(request));
        if (!result) return reply.status(404).send({ error: 'Customer agreement not found' });
        return reply.send(result);
      }

      if (accountRef) {
        const result = await getByAccountRef(fastify.db, accountRef, userRole, escalationToken, actorOf(request));
        if (!result) return reply.status(404).send({ error: 'Customer agreement not found' });
        return reply.send(result);
      }
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 403) {
        return reply.status(403).send({ error: e.message ?? 'Forbidden' });
      }
      throw err;
    }

    return reply.status(400).send({ error: 'Provide email, phone, or accountRef query parameter' });
  });

  // GET /api/v1/customer/search/fields
  // v27: field registry for the encrypted-KYC search UI. Reflects the active text-search gating
  // (substring/prefix/suffix vs equality fallback) and which result fields are L2-only. API-first:
  // the client renders only these fields and enforces nothing the server does not.
  fastify.get('/search/fields', {
    schema: {
      tags: ['customer'],
      summary: 'List QE-searchable KYC fields and their query modes',
      description: 'Restricted to level2_investigator and security_auditor (least-privilege, PCI DSS Req 7). Level 1 analysts use the blind single-record lookup only.',
      security: [{ bearerAuth: [] }],
      response: {
        200: { type: 'object', additionalProperties: true },
        401: { $ref: 'Error#' },
        403: { description: 'KYC attribute search is restricted to investigator and auditor roles.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { userRole } = request as unknown as AuthenticatedRequest;
    if (!canRunKycSearch(userRole)) {
      return reply.status(403).send({ error: 'KYC attribute search is restricted to investigator and auditor roles' });
    }
    return reply.send(getKycSearchRegistry());
  });

  // POST /api/v1/customer/search
  // v27: run one QE search (equality/range/substring/prefix/suffix) over an encrypted KYC field.
  // The server validates field, mode, length and bounds, encrypts the value locally and matches
  // over ciphertext in Atlas. Results are tier-shaped (QE:none sensitive block only for L2/auditor).
  fastify.post('/search', {
    schema: {
      tags: ['customer'],
      summary: 'Search customers over encrypted KYC fields (Queryable Encryption showcase)',
      description: `Runs a single QE search over one encrypted KYC field. The field and its
allowed query mode come from \`GET /customer/search/fields\`. The API encrypts the query
value locally; Atlas matches over ciphertext and never sees plaintext. Disallowed fields or
malformed values are rejected with 400 (never silently dropped). Sensitive QE:none result
fields are returned only to \`level2_investigator\` (with escalation token) and \`security_auditor\`.`,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['field'],
        properties: {
          field: { type: 'string', description: 'Registry field key, e.g. partyName, taxId, riskScore.' },
          value: { type: 'string', description: 'Search value for equality / substring / prefix / suffix modes.' },
          from:  { type: 'string', description: 'Range lower bound (ISO date or number).' },
          to:    { type: 'string', description: 'Range upper bound (ISO date or number).' },
          limit: { type: 'number', description: 'Max rows (1-100, default 50).' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { description: 'Unknown field or malformed query.', $ref: 'Error#' },
        401: { $ref: 'Error#' },
        403: { description: 'Level 2 access requires a valid X-Escalation-Token header.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { field: string; value?: string; from?: string; to?: string; limit?: number };
    const { userRole, escalationToken } = request as unknown as AuthenticatedRequest;
    try {
      const rows = await searchKyc(
        { field: body.field, value: body.value, from: body.from, to: body.to },
        userRole, escalationToken, actorOf(request), body.limit ?? 50,
      );
      return reply.send({ field: body.field, count: rows.length, results: rows });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 400) return reply.status(400).send({ error: e.message ?? 'Bad request' });
      if (e.statusCode === 403) return reply.status(403).send({ error: e.message ?? 'Forbidden' });
      throw err;
    }
  });

  // GET /api/v1/customer/by-id/:id
  // Resolves a customerAgreement by primary UUID  -  used by fraud case detail to auto-load
  // the customer profile linked to a case without requiring a QE equality search.
  fastify.get('/by-id/:id', {
    schema: {
      tags: ['customer'],
      summary: 'Get customer agreement by instance reference UUID',
      description: `Looks up a \`customerAgreement\` by its primary UUID (\`customerAgreementInstanceReference\`).

Used by the fraud case detail view to load the customer profile automatically from
\`fraudDiagnosisCase.linkedCustomerAgreementReference\` without requiring the analyst
to perform a manual QE equality search.

**Returned fields:** Non-sensitive plaintext fields only (name, segment, status,
enrollment date). QE:equality fields (email, phone, account reference) are not returned
 -  they are stored as ciphertext and require explicit QE search. For sensitive fields
(address, government ID) a valid escalation token is required (L2 role only).`,
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: '`customerAgreementInstanceReference` UUID.' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            customerAgreementInstanceReference: { type: 'string' },
            customerName: { type: 'string' },
            customerSegment: { type: 'string' },
            customerAgreementStatus: { type: 'string' },
            customerAgreementEnrollmentDate: { type: 'string' },
          },
          additionalProperties: true,
        },
        401: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userRole, escalationToken } = request as unknown as AuthenticatedRequest;
    try {
      const result = await getByInstanceReference(fastify.db, id, userRole, escalationToken, actorOf(request));
      if (!result) return reply.status(404).send({ error: 'Customer agreement not found' });
      return reply.send(result);
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode === 403) return (reply as typeof reply & { status(n: number): typeof reply }).status(403).send({ error: e.message ?? 'Forbidden' });
      throw err;
    }
  });
}

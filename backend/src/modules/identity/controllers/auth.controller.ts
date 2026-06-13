import { FastifyInstance, FastifyRequest } from 'fastify';
import { loginUser, getDemoUsers, getEnabledDomains, updateAuthProfile, JwtPayload } from '../services/auth.service';
import { getSelfProfile, updateSelfProfile } from '../../customer/services/customerAgreement.service';
import { CUSTOMER_AUTHENTICATION_COLLECTION, CustomerAuthenticationAssessmentRecord } from '../models/customerAuthentication.model';

export async function authController(fastify: FastifyInstance) {
  fastify.post('/login', {
    schema: {
      tags: ['auth'],
      summary: 'Login: obtain a Bearer JWT',
      description: `Authenticates a demo user against the \`customerAuthenticationAssessment\` collection
(BIAN SD-91) and returns a signed JWT valid for 24 hours.

The JWT payload contains the \`sub\` (user UUID), \`email\`, \`role\`, \`name\`, and
\`domain\` claims. Send it on every subsequent request as:

\`\`\`
Authorization: Bearer <token>
\`\`\`

**QE note:** the \`email\` lookup runs against a \`QE:equality\`-encrypted field;
Atlas stores only ciphertext and never sees the plaintext address.

**Available demo users:**

| Email | Role |
|---|---|
| \`luis.fernandez@back.es\` | customer |
| \`sarah.chen@back.es\` | level1_analyst |
| \`michael.obi@back.es\` | level2_investigator |
| \`diego.sans@back.es\` | security_auditor |

Password for all demo users: \`demo-password\``,
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'User email address. Stored as QE:equality; encrypted and searchable without Atlas seeing the plaintext.',
          },
          password: {
            type: 'string',
            description: 'User password. Stored as a 12-round bcrypt hash; the plaintext is never persisted or logged.',
          },
          domain: {
            type: 'string',
            enum: ['local', 'msentra', 'bigid'],
            default: 'local',
            description: '`local` for seeded demo users. `msentra` for Microsoft Entra ID delegation (v2). `bigid` for BigID integration (v2).',
          },
        },
      },
      response: {
        200: {
          description: 'Authentication successful. Use `token` in the Authorization header for all protected endpoints.',
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'Signed JWT, valid 24 h. Payload contains sub, email, role, name, domain.',
            },
            user: {
              type: 'object',
              description: 'Authenticated user summary.',
              properties: {
                customerAuthenticationInstanceReference: {
                  type: 'string',
                  description: 'Primary key UUID of the customerAuthenticationAssessment document (BIAN SD-91 Control Record identifier).',
                },
                name: { type: 'string', description: 'Display name.' },
                email: { type: 'string', format: 'email', description: 'Login email address.' },
                role: {
                  type: 'string',
                  enum: ['customer', 'level1_analyst', 'level2_investigator', 'security_auditor'],
                  description: 'Role encoded in the JWT. Controls what data this user can read.',
                },
              },
            },
          },
        },
        400: { description: 'Missing or invalid request fields.', $ref: 'Error#' },
        401: { description: 'Wrong email or password.', $ref: 'Error#' },
        500: { description: 'Unexpected server error.', $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { email, password, domain } = request.body as {
      email: string;
      password: string;
      domain: string;
    };

    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password are required' });
    }

    try {
      const { token, user } = await loginUser(fastify.db, email, password, domain ?? 'local');
      return reply.status(200).send({
        token,
        user: {
          customerAuthenticationInstanceReference: user.sub,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      const statusCode = (e.statusCode === 400 || e.statusCode === 401 ? e.statusCode : 500) as 400 | 401 | 500;
      return reply.status(statusCode).send({ error: e.message });
    }
  });

  fastify.get('/users', {
    schema: {
      tags: ['auth'],
      summary: 'List demo users (local domain)',
      description: `Returns active pre-seeded demo user accounts for the local authentication domain.
Intended for the UI to display one-click login shortcuts; passwords are **never** returned.
Data is read directly from the seed file to avoid QE-decryption overhead on this helper endpoint.

Pass \`?featured=true\` to return only the curated demo roster surfaced in the
debug-mode user picker (application mode) and used by the simulator.`,
      querystring: {
        type: 'object',
        properties: {
          featured: {
            type: 'string',
            enum: ['true', 'false'],
            description: 'When "true", returns only users flagged customerAuthenticationDemoFeatured.',
          },
        },
      },
      response: {
        200: {
          description: 'List of available demo users.',
          type: 'object',
          properties: {
            users: {
              type: 'array',
              description: 'All active demo accounts for the local domain.',
              items: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email', description: 'Login email; submit to POST /api/v1/auth/login.' },
                  name: { type: 'string', description: 'Display name.' },
                  role: {
                    type: 'string',
                    enum: ['customer', 'level1_analyst', 'level2_investigator', 'security_auditor', 'merchant_officer', 'manager'],
                    description: 'Role that will be encoded in the JWT on login.',
                  },
                  featured: {
                    type: 'boolean',
                    description: 'True if this user is part of the curated demo roster.',
                  },
                  merchant: {
                    type: 'string',
                    description: 'Merchant name when this user owns a merchant (customer who is also a merchant owner).',
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { featured } = request.query as { featured?: string };
    const users = await getDemoUsers(fastify.db, { featured: featured === 'true' });
    return reply.send({ users });
  });

  fastify.get('/domains', {
    schema: {
      tags: ['auth'],
      summary: 'List enabled authentication domains',
      description: `Returns all enabled authentication domains from the \`authenticationDomain\` collection (BIAN SD-16).
Only domains with \`partyAuthenticationDomainEnabled: true\` are returned.
The UI uses this to populate the domain selector on the login screen.`,
      response: {
        200: {
          description: 'List of enabled authentication domains.',
          type: 'object',
          properties: {
            domains: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Domain slug used in login requests (e.g. "local", "msentra", "bigid").' },
                  displayName: { type: 'string', description: 'Human-readable label shown in the UI.' },
                  type: { type: 'string', enum: ['local', 'oidc', 'saml'], description: 'Authentication protocol.' },
                },
              },
            },
          },
        },
        503: { description: 'Database unavailable.', $ref: 'Error#' },
      },
    },
  }, async (_request, reply) => {
    try {
      const domains = await getEnabledDomains(fastify.db);
      return reply.send({ domains });
    } catch (err: unknown) {
      const e = err as { message: string };
      return reply.status(503).send({ error: e.message });
    }
  });

  // GET /api/v1/auth/me  -  returns the authenticated user's full profile.
  // For customer role: returns JWT claims + full customerAgreement record including
  // QE:equality fields (email, phone, accountRef) and sensitive fields if linked.
  // For analyst / auditor roles: returns JWT claims only (no customerAgreement).
  fastify.get('/me', {
    schema: {
      tags: ['auth'],
      summary: 'Get authenticated user profile',
      description: `Returns the full profile of the currently authenticated user.

**Customer role:** Includes JWT claims and the linked \`customerAgreement\` record.
All QE:equality fields (email, phone, account reference) are returned in plaintext
since the user is requesting their own data. Sensitive fields (address, govt ID)
are included if found.

**Analyst / Auditor roles:** Returns JWT claims only. These users do not have
a \`customerAgreement\` record.`,
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            sub:    { type: 'string' },
            email:  { type: 'string' },
            name:   { type: 'string' },
            role:   { type: 'string' },
            domain: { type: 'string' },
            agreement: { type: 'object', nullable: true, additionalProperties: true },
          },
        },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as FastifyRequest & { user?: JwtPayload }).user;
    if (!user?.email) return reply.status(401).send({ error: 'Unauthenticated' });

    let agreement: Record<string, unknown> | null = null;
    let partyInstanceReference: string | undefined;

    if (user.role === 'customer') {
      agreement = await getSelfProfile(fastify.db, user.email).catch(() => null);
      partyInstanceReference = agreement?.partyInstanceReference as string | undefined;
    } else {
      // For non-customer roles, look up partyInstanceReference from the auth record
      // so the debug panel can show the party document for any role.
      const authRec = await fastify.db
        .collection<CustomerAuthenticationAssessmentRecord>(CUSTOMER_AUTHENTICATION_COLLECTION)
        .findOne({ customerAuthenticationInstanceReference: user.sub } as Partial<CustomerAuthenticationAssessmentRecord>);
      partyInstanceReference = authRec?.partyInstanceReference;
    }

    return reply.send({
      sub:                   user.sub,
      email:                 user.email,
      name:                  user.name,
      role:                  user.role,
      domain:                user.domain,
      partyInstanceReference,
      agreement,
    });
  });

  // PATCH /api/v1/auth/me  -  update own profile (customer only)
  fastify.patch('/me', {
    schema: {
      tags: ['auth'],
      summary: 'Update authenticated user profile',
      description: `Updates editable fields on the \`customerAgreement\` record for the
authenticated customer.

**Editable fields:** \`customerName\`, \`customerMobilePhoneNumber\`, \`customerAgreementPreferredLanguage\`.

**Not editable:** \`customerEmailAddress\` (login identity), \`customerAgreementReference\` (account key).

**QE note:** \`customerMobilePhoneNumber\` is a QE:equality field. The QE client
automatically re-encrypts the new value before writing it to Atlas.`,
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          customerName:                       { type: 'string', description: 'Updated display name.' },
          customerMobilePhoneNumber:          { type: 'string', description: 'Updated phone (QE:equality - re-encrypted automatically).' },
          customerAgreementPreferredLanguage: { type: 'string', description: 'ISO 639-1 language code (e.g. "en").' },
          customerAgreementResidentialAddress: {
            type: 'object',
            description: 'Updated address (QE:none - stored in customerAgreementSensitive).',
            properties: {
              streetAddress: { type: 'string' },
              city:          { type: 'string' },
              postalCode:    { type: 'string' },
              countryCode:   { type: 'string', description: 'ISO 3166-1 alpha-2 (e.g. "US").' },
            },
          },
        },
      },
      response: {
        200: { type: 'object', properties: { updated: { type: 'boolean' } } },
        400: { $ref: 'Error#' },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as FastifyRequest & { user?: JwtPayload }).user;
    if (!user?.email) return reply.status(401).send({ error: 'Unauthenticated' });

    const body = request.body as {
      customerName?: string;
      customerMobilePhoneNumber?: string;
      customerAgreementPreferredLanguage?: string;
      customerAgreementResidentialAddress?: {
        streetAddress: string;
        city: string;
        postalCode: string;
        countryCode: string;
      };
    };

    if (!body || Object.keys(body).length === 0) {
      return reply.status(400).send({ error: 'No fields provided for update' });
    }

    let updated: boolean;
    if (user.role === 'customer') {
      updated = await updateSelfProfile(fastify.db, user.email, body);
    } else {
      // Non-customer roles (analyst / auditor): only display name is editable
      updated = body.customerName?.trim()
        ? await updateAuthProfile(fastify.db, user.sub, body.customerName.trim())
        : false;
    }
    return reply.send({ updated });
  });
}

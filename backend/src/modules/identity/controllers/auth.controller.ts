import { FastifyInstance, FastifyRequest } from 'fastify';
import { loginUser, getDemoUsers, getEnabledDomains, updateAuthProfile, bumpSessionEpoch, JwtPayload } from '../services/auth.service';
import { getSelfProfile, updateSelfProfile } from '../../customer/services/customerAgreement.service';
import { CUSTOMER_AUTHENTICATION_COLLECTION, CustomerAuthenticationAssessmentRecord } from '../models/customerAuthentication.model';
import { PARTY_COLLECTION, PartyControlRecord } from '../models/party.model';

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
                sub: {
                  type: 'string',
                  description: 'User UUID (OIDC `sub`). Same value as customerAuthenticationInstanceReference; the canonical identity claim used by the OAuth consent flow.',
                },
                customerAuthenticationInstanceReference: {
                  type: 'string',
                  description: 'Primary key UUID of the customerAuthenticationAssessment document (BIAN SD-91 Control Record identifier). Kept for back-compat; equals `sub`.',
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
          sub: user.sub,
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

  // Server-side logout: invalidate every outstanding session token for the caller by advancing
  // their SD-91 session epoch. Stateless (no token store): the auth middleware rejects any token
  // whose stamped epoch is now behind. The client still clears its cookie, but this closes the gap
  // where a stale/copied token stayed valid until natural expiry (e.g. a hosted checkout that reads
  // the PSP session to surface saved cards). Behind the global middleware, so `request.user` is set.
  fastify.post('/logout', {
    schema: {
      tags: ['auth'],
      summary: 'Log out (invalidate the caller\'s session tokens)',
      description: 'Advances the caller\'s SD-91 session epoch, immediately invalidating all of their outstanding session JWTs server-side. No token is stored.',
      security: [{ bearerAuth: [] }],
      response: {
        200: { type: 'object', properties: { loggedOut: { type: 'boolean' } } },
        401: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const user = (request as FastifyRequest & { user?: JwtPayload }).user;
    if (!user?.sub) return reply.status(401).send({ error: 'Unauthenticated' });
    await bumpSessionEpoch(fastify.db, user.sub);
    return reply.status(200).send({ loggedOut: true });
  });

  fastify.get('/users', {
    schema: {
      tags: ['auth'],
      summary: 'List demo users (local domain)',
      description: `Returns active pre-seeded demo user accounts (DB-backed) for the local domain.
Intended for the UI to display one-click login shortcuts; passwords are **never** returned. This is
the single, non-hardcoded roster shared by the debug-mode login picker and the simulator.

Filters (combinable): \`featured=true\` (curated roster), \`role=customer,merchant_officer\`
(comma list), \`q=\` (name/email substring), \`isMerchant=true\` (only customers who own a merchant).
Results are returned in a deterministic order.`,
      querystring: {
        type: 'object',
        properties: {
          featured: { type: 'string', enum: ['true', 'false'], description: 'When "true", only users flagged customerAuthenticationDemoFeatured.' },
          role: { type: 'string', description: 'Comma-separated role filter, e.g. "customer,merchant_officer".' },
          q: { type: 'string', description: 'Case-insensitive substring match on name or email.' },
          isMerchant: { type: 'string', enum: ['true', 'false'], description: 'When "true", only customers who own a merchant.' },
        },
      },
      response: {
        200: {
          description: 'List of available demo users.',
          type: 'object',
          properties: {
            users: {
              type: 'array',
              description: 'Active demo accounts matching the filters, in deterministic order.',
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
                  featured: { type: 'boolean', description: 'True if part of the curated demo roster.' },
                  partyRef: { type: 'string', description: 'partyInstanceReference (SD-13).' },
                  merchant: {
                    type: 'object',
                    nullable: true,
                    description: 'Present when this customer owns a merchant (customer + merchant).',
                    properties: {
                      id: { type: 'string', description: 'merchantAgreementInstanceReference.' },
                      name: { type: 'string', description: 'Merchant display name.' },
                      mcc: { type: 'string', nullable: true, description: 'Merchant Category Code (ISO 18245).' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { featured, role, q, isMerchant } = request.query as { featured?: string; role?: string; q?: string; isMerchant?: string };
    const users = await getDemoUsers(fastify.db, {
      featured: featured === 'true',
      ...(role ? { role: role.split(',').map((r) => r.trim()).filter(Boolean) } : {}),
      ...(q ? { q } : {}),
      ...(isMerchant === 'true' ? { isMerchant: true } : {}),
    });
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
            partyInstanceReference: { type: 'string', nullable: true },
            party: { type: 'object', nullable: true, additionalProperties: true },
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

    // Load the SD-13 Party record (KYC-typical demographics: name, DOB, nationality, postal
    // address, contact points) so every role — staff included — has a populated profile.
    // fastify.db is the L2 client, so QE fields (email/phone) return decrypted for the caller.
    let party: Record<string, unknown> | null = null;
    if (partyInstanceReference) {
      party = await fastify.db
        .collection<PartyControlRecord>(PARTY_COLLECTION)
        .findOne({ partyInstanceReference }, { projection: { _id: 0 } })
        .catch(() => null) as Record<string, unknown> | null;
    }

    return reply.send({
      sub:                   user.sub,
      email:                 user.email,
      name:                  user.name,
      role:                  user.role,
      domain:                user.domain,
      partyInstanceReference,
      party,
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

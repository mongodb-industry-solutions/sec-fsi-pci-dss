import { FastifyInstance, FastifyRequest } from 'fastify';
import { loginUser, getEnabledDomains, registerSelfServiceUser, updateAuthProfile, bumpSessionEpoch, changeOwnPassword, JwtPayload } from '../services/auth.service';
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
        403: { description: 'Account not active (pending approval or suspended).', $ref: 'Error#' },
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
      const allowed = [400, 401, 403];
      const statusCode = (allowed.includes(e.statusCode ?? 0) ? e.statusCode : 500) as 400 | 401 | 403 | 500;
      return reply.status(statusCode).send({ error: e.message });
    }
  });

  // POST /api/v1/auth/register: public self-registration for local domains that enable it.
  // Reuses createUser (+ linked party). Role is always the lowest-privilege `customer`
  // (never client-selectable). Status is `pending` unless the domain auto-approves, in which case
  // it is `active`. This gates login only; it does NOT imply KYC approval (a separate process).
  fastify.post('/register', {
    schema: {
      tags: ['auth'],
      summary: 'Self-register a local account',
      description: 'Creates a `customer` account in a local domain that has self-registration enabled. '
        + 'If the domain auto-approves, the account is `active` (can log in immediately); otherwise it is '
        + '`pending` until a manager approves it. Email/phone are PII (party SD-13, QE-encrypted). '
        + 'Does NOT perform or imply KYC.',
      body: {
        type: 'object',
        required: ['email', 'name', 'password'],
        properties: {
          email:    { type: 'string', format: 'email', description: 'Login email. Must be unique in the domain.' },
          name:     { type: 'string', description: 'Display name.' },
          password: { type: 'string', minLength: 8, description: 'Password (policy: min 8 chars, at least one letter and one number; enforced server-side).' },
          phone:    { type: 'string', description: 'Optional mobile phone (PII); enables beneficiary lookup.' },
          domain:   { type: 'string', default: 'local', description: 'Target local domain slug.' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            status:  { type: 'string', enum: ['active', 'pending'], description: 'Resulting account status.' },
            message: { type: 'string' },
          },
        },
        400: { $ref: 'Error#', description: 'Self-registration unavailable, or invalid input.' },
        409: { $ref: 'Error#', description: 'Email or phone already in use.' },
      },
    },
  }, async (request, reply) => {
    const { email, name, password, phone, domain } = request.body as {
      email: string; name: string; password: string; phone?: string; domain?: string;
    };
    try {
      const { status } = await registerSelfServiceUser(fastify.db, {
        email, name, password, phone, domain: domain ?? 'local',
      });
      return reply.status(201).send({
        status,
        message: status === 'active'
          ? 'Account created. You can now sign in.'
          : 'Account created and awaiting approval. You can sign in once a manager approves it.',
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      const statusCode = (e.statusCode === 400 || e.statusCode === 409 ? e.statusCode : 400) as 400 | 409;
      return reply.status(statusCode).send({ error: e.message });
    }
  });

  // Server-side logout: invalidate every outstanding session token for the caller by advancing
  // their session epoch. Stateless (no token store): the auth middleware rejects any token
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

  // POST /api/v1/auth/password/change: the authenticated user changes their own password.
  // Requires the current password plus the new one (server also re-checks the policy). Confirmation
  // matching is a client-side concern, but the API accepts only `currentPassword` + `newPassword`.
  // On success every OTHER session is invalidated (epoch bump) and a fresh token is returned for
  // the current session. Behind the global auth middleware, so `request.user` is set.
  fastify.post('/password/change', {
    schema: {
      tags: ['auth'],
      summary: 'Change your own password',
      description: 'Verifies the current password, enforces the password policy on the new one, then '
        + 'rehashes it (12-round bcrypt) and invalidates all other outstanding sessions. Returns a fresh '
        + 'token so the current session stays signed in. Only available for `local` accounts.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', description: 'The account\'s current password.' },
          newPassword:     { type: 'string', minLength: 8, description: 'New password (min 8 chars, at least one letter and one number; enforced server-side).' },
        },
      },
      response: {
        200: { type: 'object', properties: { token: { type: 'string', description: 'Fresh JWT for the current session, stamped with the new session epoch.' } } },
        400: { $ref: 'Error#', description: 'Weak password, no-op change, or non-local account.' },
        401: { $ref: 'Error#', description: 'Current password is incorrect, or not authenticated.' },
        404: { $ref: 'Error#', description: 'Account not found.' },
        500: { $ref: 'Error#', description: 'Unexpected server error.' },
      },
    },
  }, async (request, reply) => {
    const user = (request as FastifyRequest & { user?: JwtPayload }).user;
    if (!user?.sub) return reply.status(401).send({ error: 'Unauthenticated' });
    const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: 'currentPassword and newPassword are required' });
    }
    try {
      const { token } = await changeOwnPassword(fastify.db, user.sub, currentPassword, newPassword);
      return reply.status(200).send({ token });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      const allowed = [400, 401, 404];
      const statusCode = (allowed.includes(e.statusCode ?? 0) ? e.statusCode : 500) as 400 | 401 | 404 | 500;
      // Don't leak internal error details on an unexpected 500; keep the specific message only for the
      // expected client errors (400/401/404).
      return reply.status(statusCode).send({ error: statusCode === 500 ? 'Internal server error' : e.message });
    }
  });

  // NOTE: the demo-user roster endpoint was consolidated to GET /api/v1/system/users (demo.controller).
  // A demo access convenience (list users by role for the login picker + simulator) belongs under
  // /system, not under /auth (real authentication). Both used the same getDemoUsers service; the
  // /auth/users duplicate was removed.

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
                  selfRegistration: { type: 'boolean', description: 'True when this local domain accepts public self-registration (login screen shows a Register link).' },
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

    // Load the Party record (KYC-typical demographics: name, DOB, nationality, postal
    // address, contact points) so every role: staff included, has a populated profile.
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

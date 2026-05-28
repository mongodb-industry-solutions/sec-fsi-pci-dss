import { FastifyInstance } from 'fastify';
import { loginUser, getDemoUsers } from '../services/auth.service';

export async function authController(fastify: FastifyInstance) {
  fastify.post('/login', {
    schema: {
      tags: ['auth'],
      summary: 'Login: obtain a Bearer JWT',
      description: `Authenticates a demo user against the \`partyAuthentication\` collection
(BIAN SD-16) and returns a signed JWT valid for 24 hours.

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
| \`luis.fernandez@leafybank.demo\` | customer |
| \`sarah.chen@leafybank.demo\` | level1_analyst |
| \`michael.obi@leafybank.demo\` | level2_investigator |
| \`admin@leafybank.demo\` | security_auditor |

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
            enum: ['local', 'msentra'],
            default: 'local',
            description: '`local` for seeded demo users. `msentra` for Microsoft Entra ID delegation (v2).',
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
                partyAuthenticationInstanceReference: {
                  type: 'string',
                  description: 'Primary key UUID of the partyAuthentication document (BIAN SD-16 Control Record identifier).',
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
          partyAuthenticationInstanceReference: user.sub,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return reply.status(e.statusCode ?? 500).send({ error: e.message });
    }
  });

  fastify.get('/users', {
    schema: {
      tags: ['auth'],
      summary: 'List demo users (Simulator mode)',
      description: `Returns all pre-seeded demo user accounts for the Simulator login panel.
Intended for the UI to display one-click login shortcuts; passwords are **never** returned.`,
      response: {
        200: {
          description: 'List of available demo users.',
          type: 'object',
          properties: {
            users: {
              type: 'array',
              description: 'All active demo accounts.',
              items: {
                type: 'object',
                properties: {
                  partyAuthenticationInstanceReference: {
                    type: 'string',
                    description: 'User UUID, use as the `sub` claim reference.',
                  },
                  partyAuthenticationUserName: {
                    type: 'string',
                    description: 'Display name.',
                  },
                  partyAuthenticationUserEmailAddress: {
                    type: 'string',
                    format: 'email',
                    description: 'Login email; submit to POST /api/v1/auth/login.',
                  },
                  partyAuthenticationUserRole: {
                    type: 'string',
                    enum: ['customer', 'level1_analyst', 'level2_investigator', 'security_auditor'],
                    description: 'Role that will be encoded in the JWT on login.',
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const users = await getDemoUsers(fastify.db);
    return reply.send({ users });
  });
}

import { FastifyInstance } from 'fastify';
import { loginUser, getDemoUsers } from '../services/auth.service';

export async function authController(fastify: FastifyInstance) {
  fastify.post('/login', {
    schema: {
      tags: ['auth'],
      summary: 'Login and obtain a JWT',
      description: `Authenticates a demo user and returns a signed JWT valid for 24 hours.
The JWT encodes \`role\`, \`email\`, \`name\`, and \`domain\` claims. Pass it as
\`Authorization: Bearer <token>\` on all subsequent requests.

**QE note:** The email lookup runs against a QE:equality-encrypted field — the plaintext
address is never stored or transmitted to MongoDB Atlas.`,
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            description: 'Demo user email address (QE:equality-encrypted at rest)',
            example: 'sarah.chen@leafybank.demo',
          },
          password: {
            type: 'string',
            description: 'Demo password (bcrypt-hashed at rest, never stored in plaintext)',
            example: 'demo-password',
          },
          domain: {
            type: 'string',
            enum: ['local', 'msentra'],
            default: 'local',
            description: 'Authentication domain. Use `local` for seeded demo users.',
          },
        },
      },
      response: {
        200: {
          description: 'Login successful',
          type: 'object',
          properties: {
            token: { type: 'string', description: 'Signed JWT — valid 24 h' },
            user: {
              type: 'object',
              properties: {
                partyAuthenticationInstanceReference: { type: 'string', description: 'UUID — BIAN Party Authentication Control Record identifier' },
                name: { type: 'string', example: 'Sarah Chen' },
                email: { type: 'string', format: 'email' },
                role: {
                  type: 'string',
                  enum: ['customer', 'level1_analyst', 'level2_investigator', 'security_auditor'],
                },
              },
            },
          },
        },
        400: { $ref: '#/components/schemas/Error' },
        401: { $ref: '#/components/schemas/Error' },
        500: { $ref: '#/components/schemas/Error' },
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
      summary: 'List available demo users',
      description: `Returns the pre-seeded demo users for the Simulator mode login panel.
Each entry includes the email and role so the UI can offer one-click login shortcuts.
Passwords are **not** returned.`,
      response: {
        200: {
          description: 'Demo user list',
          type: 'object',
          properties: {
            users: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  partyAuthenticationInstanceReference: { type: 'string' },
                  partyAuthenticationUserName: { type: 'string', example: 'Sarah Chen' },
                  partyAuthenticationUserEmailAddress: { type: 'string', format: 'email' },
                  partyAuthenticationUserRole: {
                    type: 'string',
                    enum: ['customer', 'level1_analyst', 'level2_investigator', 'security_auditor'],
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

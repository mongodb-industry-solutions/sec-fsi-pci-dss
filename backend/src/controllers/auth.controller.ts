import { FastifyInstance } from 'fastify';
import { loginUser, getDemoUsers } from '../services/auth.service';

export async function authController(fastify: FastifyInstance) {
  fastify.post('/login', async (request, reply) => {
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

  fastify.get('/users', async (_request, reply) => {
    const users = await getDemoUsers(fastify.db);
    return reply.send({ users });
  });
}

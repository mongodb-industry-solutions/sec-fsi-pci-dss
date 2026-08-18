import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

// Diagnostics are protected even while the Open Banking surface is not: bankcore has a public
// hostname so its API can be reviewed and tested, and a log buffer is not something to publish.
// The token is the platform admin JWT the PSP already issues, verified with the shared secret. The
// Open Banking endpoints get TPP client credentials in P3.7b, a different mechanism for a different
// audience.
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(request.headers.authorization ?? '');
  if (!match) {
    return reply.status(401).send({ error: 'Missing admin token' }) as never;
  }
  try {
    const payload = jwt.verify(match[1], config.app.jwtSecret) as jwt.JwtPayload;
    if (payload.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin role required' }) as never;
    }
  } catch {
    return reply.status(401).send({ error: 'Invalid admin token' }) as never;
  }
}

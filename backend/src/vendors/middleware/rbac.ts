import { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from 'jsonwebtoken';

// v1 stub: accepts any authenticated request.
// Full RBAC (field projection by role, L2 escalation gate) is implemented in v2.
export async function rbacMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as FastifyRequest & { user?: JwtPayload }).user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });
}

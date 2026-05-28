import { FastifyRequest, FastifyReply } from 'fastify';
import * as jwt from 'jsonwebtoken';

const PUBLIC_ROUTES = new Set([
  '/health',
  '/api/v1/auth/login',
  '/api/v1/auth/users',
]);

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  if (PUBLIC_ROUTES.has(request.url)) return;

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Authorization header required' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
    (request as FastifyRequest & { user: jwt.JwtPayload }).user = payload;
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

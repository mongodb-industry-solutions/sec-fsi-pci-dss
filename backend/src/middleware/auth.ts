import { FastifyRequest, FastifyReply } from 'fastify';
import * as jwt from 'jsonwebtoken';

// Exact URL matches that bypass JWT auth
const PUBLIC_EXACT: Set<string> = new Set([
  '/',
  '/health',
  '/api/v1/auth/login',
  '/api/v1/auth/users',
]);

// URL prefixes that bypass JWT auth (Swagger UI and its static assets)
const PUBLIC_PREFIXES: string[] = ['/doc'];

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const { url } = request;

  if (PUBLIC_EXACT.has(url)) return;
  if (PUBLIC_PREFIXES.some((p) => url.startsWith(p))) return;

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

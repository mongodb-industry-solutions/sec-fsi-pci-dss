import { FastifyRequest, FastifyReply } from 'fastify';
import * as jwt from 'jsonwebtoken';
import { attachRbacContext } from './rbac';

const JWT_SECRET = process.env.JWT_SECRET ?? 'demo-local-secret-change-in-production';

// Exact URL matches that bypass JWT auth
const PUBLIC_EXACT: Set<string> = new Set([
  '/',
  '/api/v1/system/health',
  '/api/v1/system/users',
  '/api/v1/auth/login',
  '/api/v1/auth/users',
  '/api/v1/auth/domains',
  '/api/v1/transactions/merchants',
  // Simulator mode: transaction creation without a user session
  '/api/v1/transactions',
  // Admin login does its own credential check
  '/api/v1/admin/login',
]);

// URL prefixes that bypass JWT auth (Swagger UI and its static assets)
// Admin run/logs endpoints handle their own admin token verification internally
const PUBLIC_PREFIXES: string[] = ['/doc', '/api/v1/admin'];

// Prefixes that bypass JWT auth only for GET requests (simulator read-only mode).
// Mutation routes (PATCH /fraud/:id, POST /fraud/:id/escalate) still require JWT.
// NOTE: if a Bearer token IS present on these routes, it is validated and the role
// is checked  -  customers are denied even on public-GET routes.
const PUBLIC_GET_PREFIXES: string[] = ['/api/v1/fraud'];

// URL prefixes and exact paths that the `customer` role is never allowed to access.
// Customers use /api/v1/auth/me for their own profile; they must not query other
// customers' data through the general customer search or investigation endpoints.
const CUSTOMER_BLOCKED_PREFIXES: string[] = [
  '/api/v1/fraud',
  '/api/v1/customer',   // QE equality searches  -  customer must use /auth/me instead
];

// Exact paths blocked for customers even when the prefix is otherwise public
const CUSTOMER_BLOCKED_EXACT: Set<string> = new Set([
  '/api/v1/audit-events',
]);

function tryVerifyToken(authHeader: string | undefined): jwt.JwtPayload | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET) as jwt.JwtPayload;
  } catch {
    return null;
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const { url, method } = request;

  if (PUBLIC_EXACT.has(url)) {
    attachRbacContext(request);
    return;
  }
  if (PUBLIC_PREFIXES.some((p) => url.startsWith(p))) {
    attachRbacContext(request);
    return;
  }

  if (method === 'GET' && PUBLIC_GET_PREFIXES.some((p) => url.startsWith(p))) {
    // Simulator mode: allow unauthenticated GET requests.
    // But if a Bearer token is present, validate it and enforce customer block.
    const payload = tryVerifyToken(request.headers.authorization);
    if (payload) {
      (request as FastifyRequest & { user: jwt.JwtPayload }).user = payload;
      if (
        (payload as { role?: string }).role === 'customer' && (
          CUSTOMER_BLOCKED_PREFIXES.some((p) => url.startsWith(p)) ||
          CUSTOMER_BLOCKED_EXACT.has(url.split('?')[0])
        )
      ) {
        return reply.status(403).send({ error: 'Access denied: this endpoint is not available to the customer role' });
      }
    }
    attachRbacContext(request);
    return;
  }

  // All other routes require a valid JWT
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Authorization header required' });
  }

  const token = authHeader.slice(7);
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    (request as FastifyRequest & { user: jwt.JwtPayload }).user = payload;
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  // Customers are blocked from investigation, customer-search, and audit endpoints.
  // They must use /api/v1/auth/me for their own profile data.
  const customerRole = (payload as { role?: string }).role === 'customer';
  if (customerRole && (
    CUSTOMER_BLOCKED_PREFIXES.some((p) => url.startsWith(p)) ||
    CUSTOMER_BLOCKED_EXACT.has(url.split('?')[0])
  )) {
    return reply.status(403).send({ error: 'Access denied: this endpoint is not available to the customer role' });
  }

  // Always populate demoRole and escalationToken after auth resolves
  attachRbacContext(request);
}

import { FastifyRequest, FastifyReply } from 'fastify';
import * as jwt from 'jsonwebtoken';
import { attachRbacContext } from './rbac';

const JWT_SECRET = process.env.JWT_SECRET ?? 'demo-local-secret-change-in-production';

// Exact URL matches that bypass JWT auth
const PUBLIC_EXACT: Set<string> = new Set([
  '/',
  '/health',
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
// Checkout, payment-link, and simulator routes are public (simulator endpoints block themselves in production via NODE_ENV guard)
// Internal stub endpoints use X-Integration-Source header validation instead of JWT (ADR-025)
const PUBLIC_PREFIXES: string[] = ['/doc', '/api/v1/admin', '/api/v1/checkout', '/api/v1/payment/links', '/api/v1/system/simulator', '/api/v1/internal'];

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

// Carve-out: a customer MAY manage their own stored cards (SD-88) even though the general
// /api/v1/customer search prefix is blocked. The card sub-routes enforce ownership in-handler
// (the path :customerId must match the caller's own agreement), so allowing the customer here
// does not expose other customers' data. Pattern: /api/v1/customer/{id}/cards[/{cardId}].
const CUSTOMER_OWN_CARD_PATH = /^\/api\/v1\/customer\/[^/]+\/cards(\/[^/]+){0,2}$/;
function isCustomerBlocked(role: string | undefined, url: string): boolean {
  if (role !== 'customer') return false;
  const path = url.split('?')[0];
  if (CUSTOMER_OWN_CARD_PATH.test(path)) return false; // own-card management is allowed
  return CUSTOMER_BLOCKED_PREFIXES.some((p) => url.startsWith(p)) || CUSTOMER_BLOCKED_EXACT.has(path);
}

// Investigation (BIAN SD-83 Fraud Diagnosis) is restricted to fraud analyst and auditor
// roles. The platform/integration `manager`, `merchant_officer` and `customer` roles must
// not read or act on fraud cases (PCI DSS Req 7 least privilege). The unauthenticated
// simulator (no token) keeps read-only access; the role check only applies when a token is
// present, so an authenticated non-analyst role is denied on BOTH read and mutation routes.
const INVESTIGATION_PREFIX = '/api/v1/fraud';
const INVESTIGATION_ROLES = new Set(['level1_analyst', 'level2_investigator', 'security_auditor']);
function blockedFromInvestigation(role: string | undefined, path: string): boolean {
  return path.startsWith(INVESTIGATION_PREFIX) && !!role && !INVESTIGATION_ROLES.has(role);
}

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
  // Match against the pathname only — query strings (e.g. ?featured=true) must
  // not break public-route matching.
  const path = url.split('?')[0];

  // Routes that opt out of JWT via `config: { skipAuth: true }` validate their own
  // caller identity in-handler. The internal capability-module engines (ADR-029:
  // /api/v1/modules/<cap>/score|screen) use the X-Integration-Source header instead
  // of a Bearer token — the EDA dispatcher calls them server-to-server, not as a user.
  const routeConfig = (request.routeOptions?.config ?? {}) as { skipAuth?: boolean };
  if (routeConfig.skipAuth) {
    attachRbacContext(request);
    return;
  }

  if (PUBLIC_EXACT.has(path)) {
    attachRbacContext(request);
    return;
  }
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
    attachRbacContext(request);
    return;
  }

  if (method === 'GET' && PUBLIC_GET_PREFIXES.some((p) => path.startsWith(p))) {
    // Simulator mode: allow unauthenticated GET requests.
    // But if a Bearer token is present, validate it and enforce customer block.
    const payload = tryVerifyToken(request.headers.authorization);
    if (payload) {
      (request as FastifyRequest & { user: jwt.JwtPayload }).user = payload;
      const role = (payload as { role?: string }).role;
      if (isCustomerBlocked(role, url)) {
        return reply.status(403).send({ error: 'Access denied: this endpoint is not available to the customer role' });
      }
      if (blockedFromInvestigation(role, path)) {
        return reply.status(403).send({ error: 'Access denied: investigation is restricted to fraud analyst and auditor roles' });
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

  // Customers are blocked from investigation, customer-search, and audit endpoints (but may
  // manage their own stored cards — see isCustomerBlocked). They use /api/v1/auth/me otherwise.
  const role = (payload as { role?: string }).role;
  if (isCustomerBlocked(role, url)) {
    return reply.status(403).send({ error: 'Access denied: this endpoint is not available to the customer role' });
  }

  // Investigation (SD-83) is for fraud analyst/auditor roles only; deny manager/officer/etc.
  if (blockedFromInvestigation(role, path)) {
    return reply.status(403).send({ error: 'Access denied: investigation is restricted to fraud analyst and auditor roles' });
  }

  // Always populate demoRole and escalationToken after auth resolves
  attachRbacContext(request);
}

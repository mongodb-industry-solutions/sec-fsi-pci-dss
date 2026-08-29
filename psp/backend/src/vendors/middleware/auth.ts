import { FastifyRequest, FastifyReply } from 'fastify';
import { attachRbacContext } from './rbac';
import { tryMerchantContext } from './validateMerchantToken';
import { verifyAccessToken, VerifiedClaims } from '../security/tokenVerifier';

// Route-level opt-out of the global HS256 auth preHandler (self-guarded / OAuth / internal routes).
// `dualAuth` accepts EITHER the PSP session JWT (HS256) OR a merchant OAuth Bearer (RS256): the route's
// own dualPermission() preHandler then authorizes by RBAC action (session) or scope (merchant) (v23).
declare module 'fastify' {
  interface FastifyContextConfig {
    skipAuth?: boolean;
    dualAuth?: boolean;
  }
}

/**
 * v39 P6.4: this application no longer authenticates anyone.
 *
 * What used to happen here was a signature check against a secret this application held, a lookup in
 * a user collection it owned, and a session-epoch read from that collection. All three are gone. What
 * remains is what a resource server does: verify a signature against the authority's PUBLISHED key
 * set, check the issuer and the expiry, and read the claims.
 *
 * The public-path allowlist, the method-scoped public paths and the customer-blocked prefixes STAY.
 * Those are this application's policy about its own routes, not identity, and moving them to the
 * authority would make it responsible for a route list it has no way to know.
 *
 * The session-epoch read is gone rather than relocated. The epoch travels IN the token now, so a
 * whole generation can be refused without a lookup; until the revocation stream lands, the bound on a
 * withdrawn session is the access-token lifetime, which is short for exactly this reason.
 */

/** What a verified caller looks like to a route handler. */
export interface AuthenticatedUser extends VerifiedClaims {
  /** The role names the authority resolved, for the checks that still reason in roles. */
  roles: string[];
}

// Exact URL matches that bypass JWT auth
const PUBLIC_EXACT: Set<string> = new Set([
  '/',
  '/health',
  '/api/v1/system/health',
  '/api/v1/system/users',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/domains',
  // OAuth2/OIDC authorization-server endpoints: authenticated by client credentials, PKCE,
  // or their own RS256 access token, NOT the PSP session JWT. Exact paths only, so the
  // session-protected /auth/me, /auth/grants and /auth/keys stay behind the middleware.
  '/.well-known/openid-configuration',
  '/api/v1/auth/jwks',
  '/api/v1/auth/authorize',
  '/api/v1/auth/token',
  '/api/v1/auth/userinfo',
  '/api/v1/auth/introspect',
  '/api/v1/auth/revoke',
  '/api/v1/transactions/merchants',
  // Simulator mode: transaction CREATION without a user session. Method-scoped below: the collection
  // GET on the same path must never be public, or it would list every movement in the platform.
  '/api/v1/transactions',
  // Admin login does its own credential check
  '/api/v1/admin/login',
]);

// URL prefixes that bypass JWT auth (Swagger UI and its static assets)
// Admin run/logs endpoints handle their own admin token verification internally
// Checkout and payment-link CREATION now require a valid JWT (no longer open). Only the buyer-facing
// routes (resolve/pay a link or session) opt out per-route via `config: { skipAuth: true }`, since the
// buyer is not logged in (hosted payment page). The simulator authenticates as the selected demo
// user and calls these real authenticated endpoints (no open /system/simulator surface).
// Internal stub endpoints use X-Integration-Source header validation instead of JWT (ADR-025)
const PUBLIC_PREFIXES: string[] = ['/doc', '/public', '/api/v1/admin', '/api/v1/internal'];

// Prefixes that bypass JWT auth only for GET requests (simulator read-only mode).
// Mutation routes (PATCH /fraud/:id, POST /fraud/:id/escalate) still require JWT.
// NOTE: if a Bearer token IS present on these routes, it is validated and the role
// is checked  -  customers are denied even on public-GET routes.
const PUBLIC_GET_PREFIXES: string[] = ['/api/v1/fraud'];

// Some public paths are only public for SOME methods. `/api/v1/transactions` is public so the
// simulator can create a payment with no session; its GET is the movement collection and must stay
// authenticated (v36: it would otherwise return every movement to an anonymous caller).
const PUBLIC_EXACT_METHODS: Record<string, ReadonlySet<string>> = {
  '/api/v1/transactions': new Set(['POST']),
};

function methodIsPublic(path: string, method: string): boolean {
  const allowed = PUBLIC_EXACT_METHODS[path];
  return !allowed || allowed.has(method);
}

// URL prefixes and exact paths that the `customer` role is never allowed to access.
// Customers use /api/v1/auth/me for their own profile; they must not query other
// customers' data through the general customer search or investigation endpoints.
const CUSTOMER_BLOCKED_PREFIXES: string[] = [
  '/api/v1/fraud',
  '/api/v1/customer',   // QE equality searches  -  customer must use /auth/me instead
  '/api/v1/modules',    // v29: built-in module admin surfaces (global card/account admin) are staff-only.
                        // The customer role has cards:[view,manage] for OWN cards (scope own), so the
                        // ACL permission alone would let it reach the global list; block by prefix (PCI DSS).
];

// Exact paths blocked for customers even when the prefix is otherwise public
const CUSTOMER_BLOCKED_EXACT: Set<string> = new Set([
  '/api/v1/audit-events',
]);

// Carve-out: a customer MAY manage their own stored cards even though the general
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

// Investigation (Fraud Diagnosis) is restricted to fraud analyst and auditor
// roles. The platform/integration `manager`, `merchant_officer` and `customer` roles must
// not read or act on fraud cases (PCI DSS least privilege). The unauthenticated
// simulator (no token) keeps read-only access; the role check only applies when a token is
// present, so an authenticated non-analyst role is denied on BOTH read and mutation routes.
const INVESTIGATION_PREFIX = '/api/v1/fraud';
const INVESTIGATION_ROLES = new Set(['level1_analyst', 'level2_investigator', 'security_auditor']);
function blockedFromInvestigation(role: string | undefined, path: string): boolean {
  return path.startsWith(INVESTIGATION_PREFIX) && !!role && !INVESTIGATION_ROLES.has(role);
}

async function tryVerifyToken(authHeader: string | undefined): Promise<AuthenticatedUser | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const claims = await verifyAccessToken(authHeader.slice(7));
  if (!claims) return null;
  return {
    ...claims,
    roles: Array.isArray(claims.roles) ? claims.roles as string[] : [],
  };
}

/**
 * The role a check reasons about.
 *
 * Read from the token rather than from a collection. Several route checks are still expressed in
 * terms of a single role name, and rewriting all of them into permission checks is a larger change
 * than this phase should carry; what matters here is that the value is one the AUTHORITY asserted.
 */
function roleOf(user: AuthenticatedUser | undefined): string | undefined {
  return user?.roles?.[0];
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const { url, method } = request;
  // Match against the pathname only: query strings (e.g. ?featured=true) must
  // not break public-route matching.
  const path = url.split('?')[0];

  // Routes that opt out of JWT via `config: { skipAuth: true }` validate their own
  // caller identity in-handler. The internal capability-module engines (ADR-029:
  // /api/v1/modules/<cap>/score|screen) use the X-Integration-Source header instead
  // of a Bearer token: the EDA dispatcher calls them server-to-server, not as a user.
  const routeConfig = (request.routeOptions?.config ?? {}) as { skipAuth?: boolean; dualAuth?: boolean };
  if (routeConfig.skipAuth) {
    attachRbacContext(request);
    return;
  }

  // Dual-auth capability route (v23): accept a first-party session JWT OR a merchant OAuth Bearer.
  // Authenticate here; the route's dualPermission() preHandler authorizes (RBAC action or scope).
  if (routeConfig.dualAuth) {
    const sessionPayload = await tryVerifyToken(request.headers.authorization);
    if (sessionPayload) {
      (request as FastifyRequest & { user: AuthenticatedUser }).user = sessionPayload;
      attachRbacContext(request);
      return;
    }
    // Not a valid session token → try the merchant OAuth channel (RS256). tryMerchantContext never
    // throws and enforces client/merchant active status; scope is enforced per-route by dualPermission.
    const merchant = await tryMerchantContext(request);
    if (merchant) {
      request.merchantContext = merchant;
      attachRbacContext(request);
      return;
    }
    return reply.status(401).send({ error: 'invalid_token', error_description: 'A valid session or OAuth token is required.' });
  }

  if (PUBLIC_EXACT.has(path) && methodIsPublic(path, method)) {
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
    const payload = await tryVerifyToken(request.headers.authorization);
    if (payload) {
      (request as FastifyRequest & { user: AuthenticatedUser }).user = payload;
      const role = roleOf(payload);
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

  const payload = await tryVerifyToken(authHeader);
  if (!payload) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
  (request as FastifyRequest & { user: AuthenticatedUser }).user = payload;

  // Customers are blocked from investigation, customer-search, and audit endpoints (but may
  // manage their own stored cards: see isCustomerBlocked). They use /api/v1/auth/me otherwise.
  const role = roleOf(payload);
  if (isCustomerBlocked(role, url)) {
    return reply.status(403).send({ error: 'Access denied: this endpoint is not available to the customer role' });
  }

  // Investigation is for fraud analyst/auditor roles only; deny manager/officer/etc.
  if (blockedFromInvestigation(role, path)) {
    return reply.status(403).send({ error: 'Access denied: investigation is restricted to fraud analyst and auditor roles' });
  }

  // Always populate userRole and escalationToken after auth resolves
  attachRbacContext(request);
}

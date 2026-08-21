/**
 * RFC 7662: Token Introspection Endpoint
 * POST /api/v1/auth/introspect
 * Authenticates the requesting OAuth client via Basic auth, then returns token metadata.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { introspectToken } from '../services/tokenIntrospection.service';
import { resolveOAuthClient } from '../services/oauth.service';

function parseBasicAuth(header: string | undefined): { id: string; secret: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return { id: decoded.slice(0, colon), secret: decoded.slice(colon + 1) };
}

export async function tokenIntrospectionController(fastify: FastifyInstance) {
  const db = () => (fastify as any).db;

  fastify.post('/introspect', {
    schema: {
      tags: ['auth:oidc'],
      summary: 'RFC 7662 Token Introspection',
      description: `Server-side token validation for OAuth clients. Requires client authentication (Authorization: Basic base64(client_id:client_secret)).\n\nReturns { active: true, ...claims } for valid tokens, or { active: false } for expired, revoked, or unknown tokens (RFC 7662 §2.2, no 401/404 to avoid information leakage).\n\n**Merchant verification strategies:**\n- Introspection (this endpoint): zero merchant-side key management, +1 HTTP round-trip per request\n- Client-side JWKS verification (GET /api/v1/auth/jwks): local crypto, no round-trip, merchant manages key rotation`,
      consumes: ['application/x-www-form-urlencoded'],
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as Record<string, string>;
    const auth = parseBasicAuth(req.headers.authorization);

    if (!auth) {
      return reply.status(401).send({ error: 'invalid_client', error_description: 'Client authentication required (Basic)' });
    }

    try {
      // Authenticate the requesting client (confidential clients must present a valid secret).
      await resolveOAuthClient(db(), auth.id, auth.secret, { requireClientAuthentication: true });
    } catch {
      return reply.status(401).send({ error: 'invalid_client', error_description: 'Invalid client credentials' });
    }

    if (!body.token) {
      return reply.status(400).send({ error: 'invalid_request', error_description: 'token parameter required' });
    }

    // Per RFC 7662: always return 200 with { active: false } for invalid tokens
    const result = await introspectToken(db(), body.token, body.token_type_hint);
    return result;
  });
}

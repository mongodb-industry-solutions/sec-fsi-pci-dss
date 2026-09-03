import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../../config';

/**
 * A compatibility shim, and nothing more.
 *
 * The wallet resolves every call it makes, business and authentication alike, from ONE base URL.
 * Repointing that base would move the account, beneficiary and transaction endpoints too and break
 * it. So the authentication paths keep answering here and are forwarded to the authority, byte for
 * byte, and the wallet changes nothing at all.
 *
 * What keeps this a proxy rather than an identity implementation:
 *
 * 1. It forwards an explicit ALLOWLIST. A new endpoint at the authority is not reachable through
 *    here unless somebody adds it deliberately.
 * 2. It does not parse, verify, rewrite, enrich or cache a token, a claim or a body. Status codes
 *    and error shapes are propagated exactly as they arrive. The moment it makes a decision about a
 *    token it has stopped being a proxy and started being a second authorization server.
 * 3. It holds no secret, no key, no session and no collection.
 * 4. It adds a forwarding header and a correlation id, and nothing else. In the audit trail it is
 *    the transport it is, and not a participant.
 *
 * It is deprecated on the day it is written. It goes when the wallet splits its base URL into a
 * business base and an issuer base, which is one variable, and not before.
 */

/** PSP path to authority path. The left side is frozen: it is the contract the wallet already has. */
const FORWARDED: Array<{ method: 'GET' | 'POST' | 'DELETE'; from: string; to: (params: Record<string, string>) => string }> = [
  { method: 'POST', from: '/enroll/challenge', to: () => '/credentials/challenge' },
  { method: 'POST', from: '/enroll', to: () => '/credentials' },
  { method: 'GET', from: '/enroll', to: () => '/credentials' },
  /**
   * Rotating and revoking ONE authenticator, which the credentials screen needs and could not reach.
   *
   * The collection was forwarded and the members were not, so a person could enrol a security key
   * and then had no way to replace or remove it: both calls answered 404. Added deliberately, which
   * is the only way anything becomes reachable through here.
   */
  { method: 'POST', from: '/enroll/:credentialId/rotate', to: (p) => `/credentials/${encodeURIComponent(p.credentialId)}/rotate` },
  { method: 'DELETE', from: '/enroll/:credentialId', to: (p) => `/credentials/${encodeURIComponent(p.credentialId)}` },
  { method: 'POST', from: '/bc-authorize', to: () => '/protocol/openid-connect/ext/ciba/auth' },
  { method: 'GET', from: '/bc-authorize/pending', to: () => '/protocol/openid-connect/ext/ciba/auth/pending' },
  { method: 'GET', from: '/bc-authorize/:authReqId', to: (p) => `/protocol/openid-connect/ext/ciba/auth/${encodeURIComponent(p.authReqId)}` },
  { method: 'GET', from: '/authorize', to: () => '/protocol/openid-connect/auth' },
  { method: 'POST', from: '/bc-authorize/:authReqId/approve', to: (p) => `/protocol/openid-connect/ext/ciba/auth/${encodeURIComponent(p.authReqId)}/approve` },
  { method: 'POST', from: '/bc-authorize/:authReqId/deny', to: (p) => `/protocol/openid-connect/ext/ciba/auth/${encodeURIComponent(p.authReqId)}/deny` },
  { method: 'POST', from: '/token', to: () => '/protocol/openid-connect/token' },
  { method: 'POST', from: '/introspect', to: () => '/protocol/openid-connect/token/introspect' },
  { method: 'POST', from: '/revoke', to: () => '/protocol/openid-connect/revoke' },
  { method: 'GET', from: '/userinfo', to: () => '/protocol/openid-connect/userinfo' },
  { method: 'GET', from: '/jwks', to: () => '/protocol/openid-connect/certs' },
  { method: 'POST', from: '/logout', to: () => '/protocol/openid-connect/logout' },
];

// Hop-by-hop headers belong to this connection, not to the forwarded one.
const NOT_FORWARDED = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'content-length',
]);

export async function authorityProxyController(fastify: FastifyInstance) {
  const issuer = () => config.giam.issuerUrl.replace(/\/+$/, '');

  async function forward(request: FastifyRequest, reply: FastifyReply, path: string) {
    const query = request.raw.url?.includes('?') ? `?${request.raw.url.split('?')[1]}` : '';
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (NOT_FORWARDED.has(name) || value === undefined) continue;
      headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    headers['x-forwarded-for'] = request.ip;
    headers['x-forwarded-host'] = String(request.headers.host ?? '');
    if (request.id) headers['x-correlation-id'] = String(request.id);

    /**
     * The body is re-encoded in the SHAPE it arrived in, not always as JSON.
     *
     * This read `JSON.stringify(body)` regardless, which quietly corrupted every form-encoded
     * request: the token endpoint is `application/x-www-form-urlencoded` by specification, so the
     * parsed fields were re-serialised as JSON and forwarded under a form content type. The
     * authority then found no `grant_type` and refused a request the client had made correctly.
     *
     * Nothing is rewritten here in the sense that matters: the same fields go out that came in. What
     * changes is only the encoding, and it changes to match the header already being forwarded.
     */
    /**
     * A body is forwarded only when one ARRIVED.
     *
     * The method alone is not the test: a DELETE carries none, and defaulting to `{}` would invent
     * a JSON body for a request that had none and send it under whatever content type was set.
     */
    const hasBody = request.method !== 'GET'
      && request.method !== 'HEAD'
      && request.body !== undefined
      && request.body !== null;
    const requestContentType = String(request.headers['content-type'] ?? '');
    let body: string | undefined;

    if (hasBody) {
      if (typeof request.body === 'string') {
        body = request.body;
      } else if (requestContentType.includes('application/x-www-form-urlencoded')) {
        body = new URLSearchParams(
          Object.entries((request.body ?? {}) as Record<string, unknown>)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([name, value]) => [name, String(value)]),
        ).toString();
      } else {
        body = JSON.stringify(request.body ?? {});
      }
    }

    let upstream: Response;
    try {
      upstream = await fetch(`${issuer()}${path}${query}`, {
        method: request.method,
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // A transport failure, reported as one. Inventing an authentication error here would send an
      // operator looking at credentials when the problem is that the authority is unreachable.
      return reply.status(502).send({
        error: 'authority_unreachable',
        error_description: 'The identity authority could not be reached.',
      });
    }

    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type');
    if (contentType) reply.header('content-type', contentType);
    return reply.status(upstream.status).send(text);
  }

  for (const route of FORWARDED) {
    const handler = async (request: FastifyRequest, reply: FastifyReply) =>
      forward(request, reply, route.to((request.params ?? {}) as Record<string, string>));

    const schema = {
      operationId: `proxy${route.method}${route.from.replace(/[^a-zA-Z]/g, '')}`,
      tags: ['identity'],
      deprecated: true,
      summary: 'Compatibility shim: forwarded to the identity authority',
      description:
        'This service no longer implements authentication. The request is forwarded verbatim to the '
        + 'identity authority, which owns the contract, and its response is returned unchanged. The '
        + 'route exists only so a client that resolves business and authentication calls from one '
        + 'base URL keeps working. It is removed when that client splits its base URL, and not before.',
    };

    const options = { schema, config: { skipAuth: true } };
    if (route.method === 'GET') fastify.get(route.from, options, handler);
    else if (route.method === 'DELETE') fastify.delete(route.from, options, handler);
    else fastify.post(route.from, options, handler);
  }
}

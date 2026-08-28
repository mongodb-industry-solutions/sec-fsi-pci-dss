import { FastifyInstance, FastifyRequest } from 'fastify';
import { authenticateTpp } from '../services/tppRegistration.service';
import { issueAccessToken } from '../services/tppAccessToken.service';
import { CORRELATED_HEADERS } from '../../../shared/standardHeaders';

// OAuth 2.0 token endpoint (RFC 6749 §3.2), client credentials grant (§4.4). This is how a registered
// TPP obtains the token every Open Banking call presents.
//
// Berlin Group does not fix a path for it, so it sits under /v1 with the rest of the published surface
// rather than at a vendor prefix a standard client would have to be told about.

interface TokenRequestBody {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  scope?: string;
}

// RFC 6749 §5.2 error body. `additionalProperties` is on because a strict response schema silently
// drops what it does not declare, and an error the caller cannot read is worse than no schema.
const OAUTH_ERROR = {
  type: 'object',
  additionalProperties: true,
  properties: {
    error: { type: 'string' },
    error_description: { type: 'string' },
  },
} as const;

// §2.3.1 prefers HTTP Basic for the client credential, so both forms are accepted.
function credentialsFromBasicAuth(request: FastifyRequest): { clientId: string; clientSecret: string } | null {
  const match = /^\s*Basic\s+(\S+)\s*$/i.exec(request.headers.authorization ?? '');
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  return {
    clientId: decodeURIComponent(decoded.slice(0, separator)),
    clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
  };
}

export async function oauthController(fastify: FastifyInstance) {
  fastify.post('/oauth/token', {
    schema: {
      tags: ['oauth'],
      headers: CORRELATED_HEADERS,
      summary: 'Obtain an access token as a registered TPP',
      description:
        'OAuth 2.0 client credentials grant (RFC 6749 §4.4), the standard machine to machine grant for '
        + 'TPP access. The client credential may be sent as HTTP Basic or in the form body. The issued '
        + 'token is scoped to what the registration grants, and it is signed with the bank\'s own key: a '
        + 'token minted anywhere else on the platform does not open this API. An omitted `scope` means '
        + 'every scope the registration holds.',
      body: {
        type: 'object',
        properties: {
          grant_type: { type: 'string', description: 'Must be `client_credentials`.' },
          client_id: { type: 'string' },
          client_secret: { type: 'string' },
          scope: { type: 'string', description: 'Space separated. Subset of the granted scopes.' },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            access_token: { type: 'string' },
            token_type: { type: 'string' },
            expires_in: { type: 'integer' },
            scope: { type: 'string' },
          },
        },
        400: OAUTH_ERROR,
        401: OAUTH_ERROR,
        503: OAUTH_ERROR,
      },
    },
  }, async (request, reply) => {
    // No caching of a credential exchange, ever (RFC 6749 §5.1).
    reply.header('Cache-Control', 'no-store');

    const body = (request.body ?? {}) as TokenRequestBody;
    if (body.grant_type !== 'client_credentials') {
      return reply.status(400).send({
        error: 'unsupported_grant_type',
        error_description: 'Only grant_type=client_credentials is supported',
      });
    }

    // The registry is the database, so with it unreachable the bank is unavailable rather than broken.
    if (fastify.dbError !== null) {
      return reply.status(503).send({
        error: 'temporarily_unavailable',
        error_description: 'The TPP registry is unavailable',
      });
    }

    const basic = credentialsFromBasicAuth(request);
    const clientId = basic?.clientId ?? body.client_id ?? '';
    const clientSecret = basic?.clientSecret ?? body.client_secret ?? '';
    if (!clientId) {
      return reply.status(400).send({ error: 'invalid_request', error_description: 'client_id is required' });
    }

    const requestedScopes = (body.scope ?? '').split(' ').filter(Boolean);
    const result = await authenticateTpp(fastify.db, clientId, clientSecret, requestedScopes);
    if (!result.ok) {
      const status = result.failure.error === 'invalid_client' ? 401 : 400;
      if (status === 401) reply.header('WWW-Authenticate', 'Basic realm="bankcore"');
      return reply.status(status).send({
        error: result.failure.error,
        error_description: result.failure.description,
      });
    }

    const { accessToken, expiresIn, scope } = issueAccessToken(result.registration, result.scopes);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn, scope };
  });
}

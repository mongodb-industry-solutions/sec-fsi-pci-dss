import { FastifyInstance } from 'fastify';
import { getJwks } from '../services/oidcKeys.service';

export async function oidcDiscoveryController(fastify: FastifyInstance) {
  const issuer = () => process.env.PSP_BASE_URL ?? 'http://localhost:8081';
  // authorization_endpoint / end_session_endpoint are browser-facing PAGES rendered by the PSP
  // frontend (login/consent UI, session cookie): the backend's own /api/v1/auth/authorize returns
  // JSON, not UI, so it must NOT be advertised here as the endpoint to redirect the user-agent to.
  const frontendBase = () => process.env.PSP_URL_FRONTEND ?? 'http://localhost:8080';

  // OIDC Discovery 1.0 §4: path fixed by spec, must be at root (no /api/v1 prefix)
  fastify.get('/.well-known/openid-configuration', {
    schema: {
      tags: ['auth:oidc'],
      summary: 'OIDC Discovery Document',
      description: 'OpenID Connect Discovery 1.0, returns the authorization server metadata.',
    },
  }, async (_req, _reply) => {
    const base = issuer();
    const feBase = frontendBase();
    return {
      issuer: base,
      authorization_endpoint: `${feBase}/auth/authorize`,
      token_endpoint: `${base}/api/v1/auth/token`,
      userinfo_endpoint: `${base}/api/v1/auth/userinfo`,
      revocation_endpoint: `${base}/api/v1/auth/revoke`,
      introspection_endpoint: `${base}/api/v1/auth/introspect`,
      jwks_uri: `${base}/api/v1/auth/jwks`,
      end_session_endpoint: `${feBase}/auth/logout`,
      // CIBA: backchannel authentication endpoint + supported delivery modes / signing algs.
      backchannel_authentication_endpoint: `${base}/api/v1/auth/bc-authorize`,
      backchannel_token_delivery_modes_supported: ['poll', 'ping', 'push'],
      backchannel_user_code_parameter_supported: false,
      backchannel_authentication_request_signing_alg_values_supported: ['RS256', 'ES256'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token', 'urn:openid:params:grant-type:ciba'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email', 'phone', 'read:transactions', 'read:userinfo', 'read:merchant_profile', 'read:orders', 'read:notifications'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
      code_challenge_methods_supported: ['S256'],
      introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
      claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'name', 'email', 'preferred_username'],
    };
  });

  // JWKS endpoint: public keys for client-side RS256 verification (ADR-036)
  fastify.get('/api/v1/auth/jwks', {
    schema: {
      tags: ['auth:oidc'],
      summary: 'JSON Web Key Set',
      description: 'Returns public RSA keys for verifying OAuth RS256 access tokens. All active and deprecated keys are included so tokens issued before key rotation remain verifiable during the grace period.',
    },
  }, async (_req, reply) => {
    const jwks = await getJwks();
    reply.header('Cache-Control', 'public, max-age=3600');
    return jwks;
  });
}

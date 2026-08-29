import { FastifyInstance } from 'fastify';
import { createHash, timingSafeEqual } from 'crypto';
import { RealmService } from '../../realm/services/realm.service';
import { ClientAuthService, readClientCredentials } from '../services/clientAuth.service';
import { TokenIssuer } from '../services/tokenIssuer.service';
import { KeyRing } from '../../keys/services/keyRing.service';
import { MongoSigningKeyStore } from '../../keys/services/signingKeyStore';
import { DirectoryService } from '../../directory/services/directory.service';
import { AUTHORIZATION_REQUEST_COLLECTION } from '../../../shared/models/collections';
import { AuthorizationRequestRecord, isRedeemable } from '../models/authorizationRequest.model';
import { scopesOf } from '../models/client.model';
import { DecisionService } from '../../authorization/services/decision.service';

/**
 * The token endpoint, RFC 6749.
 *
 * Form encoded, the specification's own error object, and every refusal is `invalid_grant` or
 * `invalid_client` rather than something descriptive: a token endpoint that explains precisely why a
 * grant failed is an oracle, and the caller cannot act on the difference anyway.
 */
export async function tokenController(fastify: FastifyInstance) {
  const ring = () => new KeyRing(new MongoSigningKeyStore(fastify.db));

  function fail(reply: never | { status: (code: number) => { send: (body: unknown) => unknown } }, status: number, error: string, description?: string) {
    return reply.status(status).send({ error, ...(description ? { error_description: description } : {}) });
  }

  fastify.post('/realms/:realm/protocol/openid-connect/token', {
    schema: {
      operationId: 'issueToken',
      tags: ['oauth'],
      summary: 'Token endpoint',
      description:
        'Standard-defined: RFC 6749 sections 4.1.3, 4.4 and 6, with PKCE per RFC 7636 and the access '
        + 'token in the RFC 9068 JWT profile. Requests are `application/x-www-form-urlencoded` and '
        + 'errors use the RFC 6749 section 5.2 object, never a house envelope. Client authentication '
        + 'is HTTP Basic or the form body, per RFC 6749 section 2.3.',
      security: [{ clientBasic: [] }, {}],
      consumes: ['application/x-www-form-urlencoded'],
      params: {
        type: 'object',
        required: ['realm'],
        properties: { realm: { type: 'string', examples: ['acme'] } },
      },
      body: {
        type: 'object',
        required: ['grant_type'],
        additionalProperties: true,
        properties: {
          grant_type: {
            type: 'string',
            description: 'authorization_code, client_credentials or refresh_token.',
            examples: ['client_credentials'],
          },
          code: { type: 'string' },
          redirect_uri: { type: 'string' },
          code_verifier: { type: 'string' },
          refresh_token: { type: 'string' },
          scope: { type: 'string' },
          client_id: { type: 'string' },
          client_secret: { type: 'string' },
        },
      },
      response: {
        200: {
          description: 'The issued tokens.',
          type: 'object',
          additionalProperties: true,
          required: ['access_token', 'token_type', 'expires_in'],
          properties: {
            access_token: { type: 'string' },
            token_type: { type: 'string' },
            expires_in: { type: 'integer' },
            scope: { type: 'string' },
            refresh_token: { type: 'string' },
            id_token: { type: 'string' },
          },
          examples: [{ access_token: 'eyJ…', token_type: 'Bearer', expires_in: 900, scope: 'openid profile' }],
        },
        400: { $ref: 'OAuthError#', description: 'The grant is invalid or unsupported.' },
        401: { $ref: 'OAuthError#', description: 'Client authentication failed.' },
      },
    },
  }, async (request, reply) => {
    const { realm: realmName } = request.params as { realm: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const grantType = String(body.grant_type ?? '');

    const realm = await new RealmService(fastify.db).byName(realmName);
    if (!realm || !realm.enabled) return fail(reply as never, 400, 'invalid_request', 'unknown realm');

    const clientAuth = new ClientAuthService(fastify.db);
    const presented = readClientCredentials(request.headers.authorization, body);

    // Every grant except the authorization code with a public client requires the client to
    // authenticate. The code grant is handled below, where PKCE stands in for the secret.
    const outcome = await clientAuth.authenticate(realm.realmId, presented, {
      requireAuthentication: grantType !== 'authorization_code',
    });
    if ('error' in outcome) return fail(reply as never, 401, outcome.error, outcome.description);
    const { client } = outcome;

    if (!clientAuth.allowsGrant(client, grantType)) {
      return fail(reply as never, 400, 'unauthorized_client', 'this client is not registered for that grant');
    }

    const issuer = new TokenIssuer(fastify.db, ring());

    if (grantType === 'client_credentials') {
      // No user is involved, so no refresh token and no id token: there is no session to refresh and
      // nobody to describe. A refresh token here would be a longer-lived copy of a credential the
      // client already holds.
      const requested = String(body.scope ?? '').split(' ').filter(Boolean);
      const allowed = scopesOf(client);
      const invalid = requested.filter((scope) => !allowed.includes(scope));
      if (invalid.length > 0) return fail(reply as never, 400, 'invalid_scope', `not permitted: ${invalid.join(' ')}`);

      // A machine principal's permissions are resolved exactly as a person's are, from the roles
      // assigned to it. That is the one-pipeline rule at the authorization step: a service identity
      // is not a special case that skips the decision point.
      const machine = await new DecisionService(fastify.db)
        .effectivePermissions(realm.realmId, client.clientId, client.clientId);

      return reply.send(await issuer.issue({
        realm,
        client,
        subjectId: client.clientId,
        scope: requested.length > 0 ? requested : allowed,
        permissions: machine.permissions,
      }));
    }

    if (grantType === 'refresh_token') {
      const presentedToken = String(body.refresh_token ?? '');
      const record = await issuer.findRefreshToken(realm.realmId, presentedToken);
      if (!record || record.clientId !== client.clientId) {
        return fail(reply as never, 400, 'invalid_grant', 'unknown refresh token');
      }
      if (record.revokedAt || Date.parse(record.expiresAt) < Date.now()) {
        return fail(reply as never, 400, 'invalid_grant', 'refresh token is no longer valid');
      }

      // Rotation: the presented token is retired as it is redeemed, so a stolen copy is usable at
      // most once and its use is detectable afterwards.
      await issuer.revoke(realm.realmId, record.jti, 'rotated');

      const directory = new DirectoryService(fastify.db);
      const identity = record.subjectId ? await directory.findBySubjectId(record.subjectId) : null;
      if (record.subjectId && !identity) {
        return fail(reply as never, 400, 'invalid_grant', 'subject no longer exists');
      }

      return reply.send(await issuer.issue({
        realm,
        client,
        subjectId: record.subjectId,
        scope: record.scope.split(' ').filter(Boolean),
        sessionId: record.sessionId,
        sessionEpoch: identity?.sessionEpoch,
        includeRefreshToken: true,
      }));
    }

    if (grantType === 'authorization_code') {
      const code = String(body.code ?? '');
      if (!code) return fail(reply as never, 400, 'invalid_grant', 'code is required');

      const codeHash = createHash('sha256').update(code).digest('hex');
      const requests = fastify.db.collection<AuthorizationRequestRecord>(AUTHORIZATION_REQUEST_COLLECTION);
      const pending = await requests.findOne({ realmId: realm.realmId, codeHash }, { projection: { _id: 0 } });

      if (!pending || pending.clientId !== client.clientId) {
        return fail(reply as never, 400, 'invalid_grant', 'unknown code');
      }
      if (pending.status === 'consumed') {
        // A replay, and it is DETECTED rather than merely absent. Everything issued from the
        // original redemption is revoked, because a code arriving twice means one of the two
        // presenters is not the client.
        if (pending.subjectId) {
          await issuer.revokeSession(realm.realmId, pending.requestId, 'code_replayed');
        }
        return fail(reply as never, 400, 'invalid_grant', 'code has already been used');
      }
      if (!isRedeemable(pending)) return fail(reply as never, 400, 'invalid_grant', 'code is expired');

      if (pending.redirectUri && pending.redirectUri !== String(body.redirect_uri ?? '')) {
        return fail(reply as never, 400, 'invalid_grant', 'redirect_uri does not match');
      }

      if (pending.pkce) {
        const verifier = String(body.code_verifier ?? '');
        if (!verifier) return fail(reply as never, 400, 'invalid_grant', 'code_verifier is required');
        const computed = pending.pkce.method === 'S256'
          ? createHash('sha256').update(verifier).digest('base64url')
          : verifier;
        const a = Buffer.from(computed);
        const b = Buffer.from(pending.pkce.challenge);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return fail(reply as never, 400, 'invalid_grant', 'code_verifier does not match');
        }
      } else if (client.requirePkce) {
        return fail(reply as never, 400, 'invalid_grant', 'this client requires PKCE');
      }

      await requests.updateOne({ requestId: pending.requestId }, { $set: { status: 'consumed' } });

      const directory = new DirectoryService(fastify.db);
      const identity = pending.subjectId ? await directory.findBySubjectId(pending.subjectId) : null;
      if (!identity) return fail(reply as never, 400, 'invalid_grant', 'subject no longer exists');

      const scope = pending.scope.split(' ').filter(Boolean);
      // Resolved at issuance and carried in the token, so a resource server reads a claim rather
      // than calling the authority on every request.
      const decision = await new DecisionService(fastify.db)
        .effectivePermissions(realm.realmId, identity.subjectId, client.clientId);

      return reply.send(await issuer.issue({
        realm,
        client,
        subjectId: identity.subjectId,
        scope,
        permissions: decision.permissions,
        sessionEpoch: identity.sessionEpoch,
        nonce: pending.nonce,
        includeRefreshToken: true,
        includeIdToken: scope.includes('openid'),
        idTokenClaims: {
          name: identity.name?.formatted,
          preferred_username: identity.userName,
          ...(scope.includes('email') && identity.primaryEmail ? { email: identity.primaryEmail } : {}),
        },
      }));
    }

    return fail(reply as never, 400, 'unsupported_grant_type', `grant_type ${grantType} is not supported`);
  });
}

import { FastifyInstance } from 'fastify';
import { oauthController } from './controllers/oauth.controller';
import { jwksController } from './controllers/jwks.controller';

// TPP trust: registration records and the token endpoint that turns a registered client into a scoped
// access token. Mounted at /v1, alongside the rest of the published surface.
export async function tppTrustModule(fastify: FastifyInstance) {
  await fastify.register(async (scope) => {
    // RFC 6749 §4.4.2 sends the token request form encoded, so the parser is registered in this scope
    // only: the Open Banking resources themselves stay JSON.
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => {
        try {
          done(null, Object.fromEntries(new URLSearchParams(body as string)));
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );
    await scope.register(oauthController, { prefix: '/v1' });
  });
  // At the root, not under /v1: a well-known path is where it is or it is not well known.
  await fastify.register(jwksController);
}

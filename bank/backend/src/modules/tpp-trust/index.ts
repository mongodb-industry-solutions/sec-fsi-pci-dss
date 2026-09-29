import { FastifyInstance } from 'fastify';
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
    // v39 P7.1: the token endpoint is gone. The identity authority issues the access tokens a
    // registered third party presents here, in this bank REALM, and this bank verifies them
    // against that realm published key set. A bank that mints its own tokens is a second
    // authority, and two authorities is how a platform ends up unable to say who is signed in.
    void scope;
  });
  // At the root, not under /v1: a well-known path is where it is or it is not well known.
  await fastify.register(jwksController);
}

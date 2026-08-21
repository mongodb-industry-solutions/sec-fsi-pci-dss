import { FastifyInstance } from 'fastify';
import { publicJwks } from '../services/bankSigningKey.service';

// The bank's public key set, so a receiver can verify a notification it was sent.
//
// At `/.well-known/jwks.json` because that is where a client looks for one, which is why it sits outside
// both `/v1` and the administration prefix: it is discovery infrastructure, not an API a TPP is authorised
// against. Public by design, and it discloses nothing: a public key is for publishing.
export async function jwksController(fastify: FastifyInstance) {
  fastify.get('/.well-known/jwks.json', {
    schema: {
      tags: ['system'],
      summary: 'Public key set for verifying the bank\'s notifications',
      description:
        'JSON Web Key Set (RFC 7517). The bank signs its Security Event Tokens with the matching private '
        + 'key, so a receiver verifies a signature rather than a shared secret, which is what it would do '
        + 'against a real ASPSP. The `kid` is derived from the key itself, so it changes when the key does '
        + 'and a receiver can cache by it.',
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: { keys: { type: 'array', items: { type: 'object', additionalProperties: true } } },
        },
      },
    },
  }, async (_request, reply) => {
    // A key set is cacheable, and a receiver that refetches it per notification is one that stops working
    // when the bank is briefly slow. Five minutes is short enough for a rotation to land quickly.
    reply.header('Cache-Control', 'public, max-age=300');
    return publicJwks();
  });
}

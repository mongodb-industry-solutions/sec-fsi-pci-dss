import { FastifyInstance } from 'fastify';
import {
  verifyNotification, applyConsentStatusChange, mapPaymentStatusChange,
} from '../services/bankcoreNotification.service';
import { getIdempotent, saveIdempotent } from '../../gateway/services/idempotency.service';

// Where the bank's notifications arrive.
//
// `skipAuth` because the caller is a BANK, not a platform user: it has no session and never will. The
// signature is the authentication, verified against the bank's published key set, so this endpoint is not
// open in any meaningful sense. Answering an unverifiable token with 401 is the whole gate.
const E = { type: 'object', additionalProperties: true, properties: { error: { type: 'string' } } } as const;

export async function bankcoreNotificationController(fastify: FastifyInstance) {
  // The token arrives as a bare JWS with the media type RFC 8935 defines, so it is read as text rather
  // than parsed as JSON. Without this parser Fastify refuses the content type before the handler runs.
  fastify.addContentTypeParser(
    'application/secevent+jwt',
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );

  fastify.post('/bankcore', {
    config: { skipAuth: true },
    schema: {
      tags: ['providers'],
      summary: 'Receive a Security Event Token from the bank',
      description:
        'The bank notifies a consent or payment status change here (RFC 8417 token, RFC 8935 push '
        + 'delivery). The body is the signed JWS itself, not a JSON envelope.\n\n'
        + 'Authentication is the SIGNATURE, verified against the key set the bank publishes: this endpoint '
        + 'takes no platform session because the caller is a bank and has none. RS256 is pinned rather than '
        + 'read from the token, since accepting whatever a token asks for is how `alg: none` gets in.\n\n'
        + 'Idempotent on the token id, so a redelivery is acknowledged without being applied twice. A '
        + 'verified event is then re-emitted on the PSP\'s own bus, which is what keeps the existing payment '
        + 'orchestration working unchanged now that the engine raising it lives in another service.\n\n'
        + 'A key set that cannot be read answers 400, not 401: 401 tells the bank to stop retrying, and '
        + 'retrying is exactly what should happen while our own dependency is unavailable.',
      body: { type: 'string' },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            received: { type: 'boolean' },
            eventType: { type: 'string' },
            detail: { type: 'string' },
            replayed: { type: 'boolean' },
          },
        },
        400: E,
        401: E,
      },
    },
  }, async (request, reply) => {
    const token = typeof request.body === 'string' ? request.body : '';
    const verified = await verifyNotification(fastify.db, token);
    if (!verified.ok) {
      // Logged at warn so it reaches the admin log buffer: a rejected notification from the bank is
      // exactly the kind of failure that is invisible until a transfer hangs.
      request.log.warn(`[bankcore/notification] refused: ${verified.error}`);
      return reply.status(verified.status).send({ error: verified.error });
    }
    const { notification } = verified;

    // The token id is the idempotency key the standard already gives us, so a redelivery is free to
    // happen. Reusing the PSP's own store rather than a second one: it is the same problem.
    const scope = 'bankcore.notification';
    const seen = await getIdempotent<{ detail: string }>(fastify.db, scope, 'bankcore', notification.eventId);
    if (seen) {
      return {
        received: true, eventType: notification.eventType, detail: seen.detail ?? 'already applied', replayed: true,
      };
    }

    const applied = notification.eventType === 'consent.status.changed'
      ? await applyConsentStatusChange(fastify.db, notification)
      : mapPaymentStatusChange(notification);

    if (applied.busEvent) {
      // Re-emitted on the PSP's own bus, which is the point of the whole boundary: the in-process
      // subscribers that used to hear the built-in engine keep hearing the same names.
      const { getEventBus, makeEvent } = await import('../../../vendors/eventbus');
      void getEventBus().publish(makeEvent({
        eventType: applied.busEvent.name,
        correlationId: notification.correlationId ?? notification.subjectReference,
        businessProcess: 'payment_processing',
        source: 'bankcore.notification',
        payload: applied.busEvent.payload,
        bian: { serviceDomain: 'Payment Execution', controlRecord: 'PaymentExecutionProcedure' },
      }));
    }

    // Stored AFTER applying, so a crash midway leaves the event redeliverable rather than swallowed.
    await saveIdempotent(fastify.db, scope, 'bankcore', notification.eventId, { detail: applied.detail });

    return {
      received: true,
      eventType: notification.eventType,
      detail: applied.detail,
      replayed: false,
    };
  });
}

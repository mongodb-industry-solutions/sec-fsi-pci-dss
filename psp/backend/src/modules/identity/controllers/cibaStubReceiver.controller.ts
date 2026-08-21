/**
 * CIBA ping/push demo stub receiver (tag auth:ciba).
 *
 * A local, in-repo client_notification_endpoint so the demo can VISUALISE ping/push delivery without
 * an external merchant server. It stores the last received notifications in an in-memory ring buffer.
 * Mounted at /api/v1/auth/ciba/notify. The routes opt out of JWT (config.skipAuth) and authenticate the
 * caller with the CIBA client_notification_token (Bearer) that the server was configured to send, so a
 * random caller cannot inject fake notifications.
 *
 * This is a demo/reference receiver, NOT part of the CIBA protocol surface. Real relying parties host
 * their own notification endpoint. Not for production use.
 */
import { FastifyInstance } from 'fastify';

interface ReceivedNotification {
  receivedAt: string;
  event: string;
  authReqId?: string;
  hasTokens: boolean;
  data: Record<string, unknown>;
}

// Ring buffer (last 50). Process-local; cleared on restart. Demo visualisation only.
const RECEIVED: ReceivedNotification[] = [];
const MAX = 50;

// The token the stub expects as Bearer. Configure via env to match the CIBA client's
// client_notification_token used in the demo; defaults to a documented demo value.
function expectedToken(): string {
  return process.env.CIBA_STUB_NOTIFICATION_TOKEN ?? 'demo-ciba-notification-token';
}

export async function cibaStubReceiverController(fastify: FastifyInstance) {
  fastify.post('/ciba/notify', {
    config: { skipAuth: true },
    schema: {
      tags: ['auth:ciba'],
      summary: 'CIBA ping/push demo stub receiver',
      description: 'Demo-only client_notification_endpoint. Accepts the ping/push callback authenticated by the CIBA client_notification_token (Bearer). Stores the notification for the demo UI. Not part of the CIBA protocol; not for production.',
    },
  }, async (request, reply) => {
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${expectedToken()}`) {
      return reply.status(401).send({ error: 'invalid_token', error_description: 'notification token mismatch' });
    }
    const body = (request.body ?? {}) as { event?: string; data?: Record<string, unknown> };
    const data = body.data ?? {};
    const entry: ReceivedNotification = {
      receivedAt: new Date().toISOString(),
      event: body.event ?? 'unknown',
      authReqId: typeof data.auth_req_id === 'string' ? data.auth_req_id : undefined,
      hasTokens: typeof data.access_token === 'string',
      // Never echo raw tokens back through the demo listing; redact push token material.
      data: { ...data, access_token: undefined, id_token: undefined, refresh_token: undefined },
    };
    RECEIVED.unshift(entry);
    if (RECEIVED.length > MAX) RECEIVED.length = MAX;
    return { received: true };
  });

  fastify.get('/ciba/notify', {
    config: { skipAuth: true },
    schema: {
      tags: ['auth:ciba'],
      summary: 'List recently received CIBA ping/push notifications (demo)',
      description: 'Returns the in-memory ring buffer of notifications received by the demo stub receiver, for visualisation in the demo UI.',
    },
  }, async (request, reply) => {
    // Same Bearer gate as the POST receiver: the buffer carries auth_req_id / event metadata, so it
    // must not be world-readable in shared/staging environments even though tokens are redacted.
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${expectedToken()}`) {
      return reply.status(401).send({ error: 'invalid_token', error_description: 'notification token mismatch' });
    }
    return { notifications: RECEIVED };
  });
}

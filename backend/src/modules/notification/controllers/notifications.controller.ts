import { FastifyInstance } from 'fastify';
import { listForParty, unreadCount, markRead, markAllRead } from '../notifications.service';
import { subscribePartyNotifications } from '../../../vendors/eventbus';

function partyOf(request: unknown): string {
  return (request as { user?: { partyRef?: string } }).user?.partyRef ?? '';
}

// Customer notifications. Surfaces pending fraud-investigation questions (actionable) and resolved
// transaction reviews (informational). Scoped to the caller's own party (PCI DSS Req 7); customers
// are not exposed to fraud-case internals here, only the item and a link to the related transaction.
export async function notificationsController(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      tags: ['notifications'],
      summary: 'Notifications for the current user',
      description: 'Returns the signed-in user\'s notifications (unanswered security questions and '
        + 'resolved transaction reviews). `count` is the number of actionable (unread) items.',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (request) => {
    const partyRef = partyOf(request);
    const [items, count] = await Promise.all([
      listForParty(fastify.db, partyRef),
      unreadCount(fastify.db, partyRef),
    ]);
    return { count, items };
  });

  // POST /api/v1/notifications/:id/read  -  mark one notification read (own only).
  fastify.post<{ Params: { id: string } }>('/:id/read', {
    schema: { tags: ['notifications'], summary: 'Mark a notification read', security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const ok = await markRead(fastify.db, request.params.id, partyOf(request));
    if (!ok) return reply.status(404).send({ error: 'Notification not found' });
    return { ok: true };
  });

  // POST /api/v1/notifications/read-all  -  mark all of the caller's notifications read.
  fastify.post('/read-all', {
    schema: { tags: ['notifications'], summary: 'Mark all notifications read', security: [{ bearerAuth: [] }] },
  }, async (request) => {
    const updated = await markAllRead(fastify.db, partyOf(request));
    return { updated };
  });

  // GET /api/v1/notifications/stream  -  SSE signal that the caller's notifications changed (a new
  // question was raised, or one was answered). Carries no data; the client refetches the scoped list.
  // Auth required; scoped to the caller's own party (PCI DSS Req 7). fetch + Bearer header (no URL token).
  fastify.get('/stream', {
    schema: { tags: ['notifications'], summary: 'Live notifications signal (SSE)', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const partyRef = (request as unknown as { user?: { partyRef?: string } }).user?.partyRef;
    if (!partyRef) return reply.status(401).send({ error: 'Authentication required' });

    reply.hijack();
    const res = reply.raw;
    // hijack() bypasses Fastify's CORS hook; echo CORS headers or the browser blocks the stream.
    const origin = (request.headers.origin as string | undefined) ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    });
    res.write('event: ready\ndata: {}\n\n');

    const unsubscribe = subscribePartyNotifications(partyRef, () => res.write('data: {"changed":true}\n\n'));
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
    request.raw.on('close', () => { clearInterval(keepAlive); unsubscribe(); res.end(); });
  });
}

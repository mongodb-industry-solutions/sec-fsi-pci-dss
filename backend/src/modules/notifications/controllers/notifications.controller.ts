import { FastifyInstance } from 'fastify';
import { getNotificationsForParty } from '../notifications.service';
import { subscribePartyNotifications } from '../../../vendors/events/caseEventBus';

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
    const partyRef = (request as unknown as { user?: { partyRef?: string } }).user?.partyRef ?? '';
    const items = await getNotificationsForParty(fastify.db, partyRef);
    return { count: items.filter((i) => i.actionable).length, items };
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
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('event: ready\ndata: {}\n\n');

    const unsubscribe = subscribePartyNotifications(partyRef, () => res.write('data: {"changed":true}\n\n'));
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
    request.raw.on('close', () => { clearInterval(keepAlive); unsubscribe(); res.end(); });
  });
}

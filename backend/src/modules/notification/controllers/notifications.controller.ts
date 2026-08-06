import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { listForParty, unreadCount, markRead, markAllRead } from '../notifications.service';
import { subscribePartyNotifications } from '../../../vendors/eventbus';
import { beginSSE } from '../../../shared/services/sse';
import { resolvePartyInstanceReference } from '../../identity/services/oauth.service';

// Resolve the caller's own party across BOTH auth channels (v23):
//  · OAuth (merchant on-behalf-of): require scope read:notifications, party = resolveParty(token.sub).
//  · Session: the JWT partyRef (existing behavior).
// Returns null when a reply has already been sent (missing scope / unmapped subject).
async function resolveNotificationParty(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const merchant = request.merchantContext;
  if (merchant) {
    if (!merchant.scopes.includes('read:notifications')) {
      reply.status(403).send({ error: 'insufficient_scope', error_description: 'Required scope: read:notifications' });
      return null;
    }
    // Unmapped subject → empty string; downstream lookups yield an empty list / 404 (never a leak).
    return (await resolvePartyInstanceReference(request.server.db, merchant.sub)) ?? '';
  }
  return (request as { user?: { partyRef?: string } }).user?.partyRef ?? '';
}

function partyOf(request: unknown): string {
  return (request as { user?: { partyRef?: string } }).user?.partyRef ?? '';
}

// Customer notifications. Surfaces pending fraud-investigation questions (actionable) and resolved
// transaction reviews (informational). Scoped to the caller's own party (PCI DSS); customers
// are not exposed to fraud-case internals here, only the item and a link to the related transaction.
export async function notificationsController(fastify: FastifyInstance) {
  fastify.get('/', {
    config: { dualAuth: true },
    schema: {
      tags: ['notifications'],
      summary: 'Notifications for the current user',
      description: 'Returns the signed-in user\'s notifications (unanswered security questions and '
        + 'resolved transaction reviews). `count` is the number of actionable (unread) items. '
        + 'Scoped to the caller\'s own partyRef (PCI DSS Req 7); customers never see other parties\' alerts.',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            count: { type: 'number', description: 'Number of unread (actionable) notifications.' },
            items: {
              type: 'array',
              description: 'Notification list, newest first.',
              items: {
                type: 'object',
                properties: {
                  id:            { type: 'string',            description: 'Notification UUID.' },
                  type:          { type: 'string',            description: 'Category: fraud_question | transaction_status | kyc_status | kyb_status | security_message | question_response.' },
                  title:         { type: 'string',            description: 'Short notification title shown in the bell and list.' },
                  detail:        { type: 'string',            description: 'Full notification body text.' },
                  href:          { type: 'string',            description: 'App-relative URL the notification links to (e.g. /system/payment/history/:txnId).' },
                  status:        { type: 'string',            description: 'Read state: unread | read.' },
                  actionable:    { type: 'boolean',           description: 'True when the customer must act (e.g. answer a security question); drives the unread badge weight.' },
                  transactionId: { type: ['string', 'null'],  description: 'Linked transaction reference, if applicable.' },
                  caseReference: { type: ['string', 'null'],  description: 'Linked fraud-case reference, if applicable.' },
                  createdAt:     { type: 'string', format: 'date-time', description: 'ISO-8601 creation timestamp.' },
                  readAt:        { type: ['string', 'null'],  description: 'ISO-8601 timestamp when the notification was marked read, or null.' },
                },
              },
            },
          },
        },
        401: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const partyRef = await resolveNotificationParty(request, reply);
    if (partyRef === null) return; // reply already sent (missing scope)
    const [items, count] = await Promise.all([
      listForParty(fastify.db, partyRef),
      unreadCount(fastify.db, partyRef),
    ]);
    return { count, items };
  });

  // POST /api/v1/notifications/:id/read  -  mark one notification read (own only).
  fastify.post<{ Params: { id: string } }>('/:id/read', {
    config: { dualAuth: true },
    schema: {
      tags: ['notifications'],
      summary: 'Mark a notification read',
      description: 'Marks a single notification as read. Only the notification\'s owner can mark it read (scoped by partyRef). Returns 404 if not found or if the notification belongs to a different party.',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'Notification ID to mark read.' } } },
      response: {
        200: { type: 'object', properties: { ok: { type: 'boolean', description: 'Always true on success.' } } },
        401: { type: 'object', properties: { error: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' } }, description: 'Notification not found or belongs to a different party.' },
      },
    },
  }, async (request, reply) => {
    const partyRef = await resolveNotificationParty(request, reply);
    if (partyRef === null) return; // reply already sent (missing scope)
    const ok = await markRead(fastify.db, request.params.id, partyRef);
    if (!ok) return reply.status(404).send({ error: 'Notification not found' });
    return { ok: true };
  });

  // POST /api/v1/notifications/read-all  -  mark all of the caller's notifications read.
  fastify.post('/read-all', {
    schema: {
      tags: ['notifications'],
      summary: 'Mark all notifications read',
      description: 'Marks all unread notifications belonging to the authenticated user as read. Scoped to the caller\'s own partyRef.',
      security: [{ bearerAuth: [] }],
      response: {
        200: { type: 'object', properties: { updated: { type: 'number', description: 'Number of notifications that were marked read.' } } },
        401: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request) => {
    const updated = await markAllRead(fastify.db, partyOf(request));
    return { updated };
  });

  // GET /api/v1/notifications/stream  -  SSE signal that the caller's notifications changed (a new
  // question was raised, or one was answered). Carries no data; the client refetches the scoped list.
  // Auth required; scoped to the caller's own party (PCI DSS). fetch + Bearer header (no URL token).
  fastify.get('/stream', {
    schema: {
      tags: ['notifications'],
      summary: 'Live notifications signal (SSE)',
      description: 'Server-Sent Events stream. Sends a `changed` signal whenever the caller\'s notifications change '
        + '(new security question raised or one answered). The client must refetch `GET /notifications` on receiving the signal. '
        + 'Carries no notification data itself (only a trigger). Requires Bearer token in the Authorization header, no URL token.',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const partyRef = (request as unknown as { user?: { partyRef?: string } }).user?.partyRef;
    if (!partyRef) return reply.status(401).send({ error: 'Authentication required' });

    const res = beginSSE(reply, request);
    res.write('event: ready\ndata: {}\n\n');

    const unsubscribe = subscribePartyNotifications(partyRef, () => res.write('data: {"changed":true}\n\n'));
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
    request.raw.on('close', () => { clearInterval(keepAlive); unsubscribe(); res.end(); });
  });
}

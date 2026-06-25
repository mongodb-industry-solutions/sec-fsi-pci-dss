import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import * as jwt from 'jsonwebtoken';
import { beginSSE } from '../../../shared/sse';

export interface WebhookEntry {
  id: string;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  timestamp: string;
  ip: string;
  // The response this endpoint sent back to the caller (what the webhook emitter received).
  response: { status: number; body: unknown };
}

const MAX_BUFFER = 200;
const buffer: WebhookEntry[] = [];
const clients = new Set<NodeJS.WritableStream>();

function broadcast(event: string, text: string) {
  const frame = `event: ${event}\ndata: ${JSON.stringify({ text })}\n\n`;
  for (const client of [...clients]) {
    try { client.write(frame); } catch { clients.delete(client); }
  }
}

function jwtSecret() {
  return process.env.JWT_SECRET ?? 'demo-local-secret-change-in-production';
}

function authorized(authHeader: string | undefined): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false;
  try {
    const payload = jwt.verify(authHeader.slice(7), jwtSecret()) as jwt.JwtPayload;
    return payload.role === 'admin';
  } catch { return false; }
}

export async function webhookInspectorController(fastify: FastifyInstance) {

  // ANY /webhook/hook — public catch-all receiver
  fastify.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    url: '/hook',
    config: { skipAuth: true },
    schema: {
      tags: ['admin'],
      summary: 'Webhook catch-all receiver',
      description: 'Public endpoint that accepts any HTTP method and records the request in the in-memory buffer for inspection in the admin panel.',
    },
    handler: async (request, reply) => {
      const id = uuidv4();
      const responseStatus = 200;
      const responseBody = { received: true, id };
      const entry: WebhookEntry = {
        id,
        method: request.method,
        path: request.url,
        query: (request.query as Record<string, string>) ?? {},
        headers: request.headers as Record<string, string>,
        body: request.body ?? null,
        timestamp: new Date().toISOString(),
        ip: request.ip,
        response: { status: responseStatus, body: responseBody },
      };
      if (buffer.length >= MAX_BUFFER) buffer.shift();
      buffer.push(entry);
      broadcast('request', JSON.stringify(entry));
      return reply.status(responseStatus).send(responseBody);
    },
  });

  // GET /webhook/stream — SSE, admin only; replays buffer on connect
  fastify.get('/stream', {
    schema: {
      tags: ['admin'],
      summary: 'Webhook SSE stream',
      description: 'Server-Sent Events stream. Replays the in-memory buffer on connect, then pushes new events in real time. Admin JWT required.',
      security: [{ adminAuth: [] }],
    },
  }, async (request, reply) => {
    if (!authorized(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const raw = beginSSE(reply, request);
    // Disable Nagle's algorithm: send each small SSE frame immediately instead of
    // coalescing it. Without this, a lone event can sit in the TCP/socket buffer
    // until the next write — the reason new requests only appeared after a manual
    // reconnect (which replays the whole buffer at once).
    raw.socket?.setNoDelay(true);
    raw.flushHeaders();
    // Initial padding comment pushes the response past the client/intermediary
    // initial read-buffer threshold, so the very first real events flush promptly.
    raw.write(`: connected${' '.repeat(2048)}\n\n`);

    for (const entry of buffer) {
      raw.write(`event: request\ndata: ${JSON.stringify({ text: JSON.stringify(entry) })}\n\n`);
    }
    clients.add(raw);

    // Heartbeat keeps the connection warm through idle periods and flushes the
    // pipe periodically (parity with the /admin/logs stream, which writes on a
    // timer). Comment frames (": ...") are ignored by SSE parsers.
    const heartbeat = setInterval(() => {
      try { raw.write(`: ping\n\n`); } catch { /* socket gone; cleanup runs on close */ }
    }, 15000);

    const cleanup = () => { clearInterval(heartbeat); clients.delete(raw); };
    raw.on('close', cleanup);
    request.raw.on('close', cleanup);
  });

  // DELETE /webhook/requests — clear buffer, admin only
  fastify.delete('/requests', {
    schema: {
      tags: ['admin'],
      summary: 'Clear all webhook requests',
      description: 'Clears the entire in-memory buffer and broadcasts a clear event to all connected SSE clients. Admin JWT required.',
      security: [{ adminAuth: [] }],
    },
  }, async (request, reply) => {
    if (!authorized(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    buffer.length = 0;
    broadcast('clear', '');
    return reply.send({ cleared: true });
  });

  // DELETE /webhook/requests/:id — remove single entry, admin only
  fastify.delete<{ Params: { id: string } }>('/requests/:id', {
    schema: {
      tags: ['admin'],
      summary: 'Delete a single webhook request',
      description: 'Removes one entry from the buffer by ID and broadcasts a delete event to all connected SSE clients. Admin JWT required.',
      security: [{ adminAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string', description: 'UUID of the webhook entry to delete' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    if (!authorized(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const idx = buffer.findIndex((e) => e.id === request.params.id);
    if (idx === -1) return reply.status(404).send({ error: 'Not found' });
    buffer.splice(idx, 1);
    broadcast('delete', request.params.id);
    return reply.send({ deleted: true });
  });
}

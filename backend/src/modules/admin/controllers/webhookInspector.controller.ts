import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import * as jwt from 'jsonwebtoken';

export interface WebhookEntry {
  id: string;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  timestamp: string;
  ip: string;
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
    handler: async (request, reply) => {
      const entry: WebhookEntry = {
        id: uuidv4(),
        method: request.method,
        path: request.url,
        query: (request.query as Record<string, string>) ?? {},
        headers: request.headers as Record<string, string>,
        body: request.body ?? null,
        timestamp: new Date().toISOString(),
        ip: request.ip,
      };
      if (buffer.length >= MAX_BUFFER) buffer.shift();
      buffer.push(entry);
      broadcast('request', JSON.stringify(entry));
      return reply.status(200).send({ received: true, id: entry.id });
    },
  });

  // GET /webhook/stream — SSE, admin only; replays buffer on connect
  fastify.get('/stream', async (request, reply) => {
    if (!authorized(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    });
    reply.raw.flushHeaders();
    for (const entry of buffer) {
      reply.raw.write(`event: request\ndata: ${JSON.stringify({ text: JSON.stringify(entry) })}\n\n`);
    }
    clients.add(reply.raw);
    reply.raw.on('close', () => clients.delete(reply.raw));
  });

  // DELETE /webhook/requests — clear buffer, admin only
  fastify.delete('/requests', async (request, reply) => {
    if (!authorized(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    buffer.length = 0;
    broadcast('clear', '');
    return reply.send({ cleared: true });
  });

  // DELETE /webhook/requests/:id — remove single entry, admin only
  fastify.delete<{ Params: { id: string } }>('/requests/:id', async (request, reply) => {
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
